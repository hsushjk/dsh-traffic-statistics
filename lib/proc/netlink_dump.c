

#define _GNU_SOURCE
#include <arpa/inet.h>
#include <errno.h>
#include <linux/inet_diag.h>
#include <linux/netlink.h>
#include <linux/rtnetlink.h>
#include <linux/sock_diag.h>
#include <linux/tcp.h>
#include <linux/udp.h>
#include <netinet/in.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

#define RECV_CHUNK 65536

#define DIAG_EXT_COUNTERS 3


static long long tcp_field_u64(const void *info, int info_len, size_t offset) {
    if (info_len < 0 || (size_t)info_len < offset + sizeof(unsigned long long)) return -1;
    unsigned long long value = 0;
    memcpy(&value, (const unsigned char *)info + offset, sizeof(value));
    return (long long)value;
}



static int has_identity(const struct inet_diag_msg *di) {
    return di->idiag_inode != 0;
}

static const char *netid_for(int protocol) {
    return protocol == IPPROTO_TCP ? "tcp" : "udp";
}

static int dump_page_end(void) {
    return fputs("--page\n", stdout) < 0 ? -1 : fflush(stdout);
}


static int dump(int family, int protocol) {
    int fd = socket(AF_NETLINK, SOCK_RAW | SOCK_CLOEXEC, NETLINK_SOCK_DIAG);
    if (fd < 0) {
        perror("socket(AF_NETLINK)");
        return 1;
    }

    struct sockaddr_nl local = {0};
    local.nl_family = AF_NETLINK;
    if (bind(fd, (struct sockaddr *)&local, sizeof(local)) < 0) {
        perror("bind");
        close(fd);
        return 1;
    }

    struct {
        struct nlmsghdr nlh;
        struct inet_diag_req_v2 req;
    } request = {0};
    request.nlh.nlmsg_len = sizeof(request);
    request.nlh.nlmsg_type = SOCK_DIAG_BY_FAMILY;
    request.nlh.nlmsg_flags = NLM_F_REQUEST | NLM_F_DUMP;
    request.nlh.nlmsg_seq = 1;
    request.req.sdiag_family = (unsigned char)family;
    request.req.sdiag_protocol = (unsigned char)protocol;
    request.req.idiag_ext = DIAG_EXT_COUNTERS;
    request.req.idiag_states = ~0U;

    struct sockaddr_nl kernel = {0};
    kernel.nl_family = AF_NETLINK;
    struct iovec iov = {.iov_base = &request, .iov_len = sizeof(request)};
    struct msghdr msg = {0};
    msg.msg_name = &kernel;
    msg.msg_namelen = sizeof(kernel);
    msg.msg_iov = &iov;
    msg.msg_iovlen = 1;
    if (sendmsg(fd, &msg, 0) < 0) {
        perror("sendmsg");
        close(fd);
        return 1;
    }

    static unsigned char buffer[RECV_CHUNK];
    for (;;) {
        ssize_t nread = recv(fd, buffer, sizeof(buffer), 0);
        if (nread < 0) {
            if (errno == EINTR) continue;
            perror("recv");
            close(fd);
            return 1;
        }
        if (nread == 0) break;
        int remaining = (int)nread;
        int done = 0;
        for (struct nlmsghdr *h = (struct nlmsghdr *)buffer; NLMSG_OK(h, remaining); h = NLMSG_NEXT(h, remaining)) {
            if (h->nlmsg_type == NLMSG_DONE) {
                done = 1;
                break;
            }
            if (h->nlmsg_type == NLMSG_ERROR) {
                const struct nlmsgerr *err = (const struct nlmsgerr *)NLMSG_DATA(h);
                fprintf(stderr, "netlink error %d\n", err->error);
                close(fd);
                return 1;
            }
            if (h->nlmsg_type != SOCK_DIAG_BY_FAMILY) continue;
            const struct inet_diag_msg *di = (const struct inet_diag_msg *)NLMSG_DATA(h);
            if (!has_identity(di)) continue;
            int attrs_remaining = (int)h->nlmsg_len - (int)NLMSG_ALIGN(sizeof(*di));
            const struct rtattr *attr = (const struct rtattr *)((const unsigned char *)di + NLMSG_ALIGN(sizeof(*di)));
            long long received = -1;
            long long sent = -1;
            for (; RTA_OK(attr, attrs_remaining); attr = RTA_NEXT(attr, attrs_remaining)) {
                if (attr->rta_type != INET_DIAG_INFO) continue;
                const void *info = RTA_DATA(attr);
                int info_len = (int)RTA_PAYLOAD(attr);
                if (protocol == IPPROTO_TCP) {
                    received = tcp_field_u64(info, info_len, offsetof(struct tcp_info, tcpi_bytes_received));
                    sent = tcp_field_u64(info, info_len, offsetof(struct tcp_info, tcpi_bytes_acked));
                    if (sent < 0) sent = tcp_field_u64(info, info_len, offsetof(struct tcp_info, tcpi_bytes_sent));
                } else {

#ifdef UDPIAG_BYTES_RECEIVED
                    received = udp_field_u64(info, info_len, 0);
#endif
                }
            }
            char local[INET6_ADDRSTRLEN] = "?";
            char remote[INET6_ADDRSTRLEN] = "?";
            if (di->idiag_family == AF_INET) {
                inet_ntop(AF_INET, &di->id.idiag_src, local, sizeof(local));
                inet_ntop(AF_INET, &di->id.idiag_dst, remote, sizeof(remote));
            } else if (di->idiag_family == AF_INET6) {
                inet_ntop(AF_INET6, &di->id.idiag_src, local, sizeof(local));
                inet_ntop(AF_INET6, &di->id.idiag_dst, remote, sizeof(remote));
            } else {
                continue;
            }
            printf("%s\t%d\t%d\t%u\t%s\t%u\t%s\t%u\t%u\t%lld\t%lld\n",
                   netid_for(protocol),
                   di->idiag_family,
                   di->idiag_state,
                   (unsigned)ntohs(di->id.idiag_sport),
                   local,
                   (unsigned)ntohs(di->id.idiag_dport),
                   remote,
                   (unsigned)di->idiag_uid,
                   (unsigned)di->idiag_inode,
                   received,
                   sent);
        }

        if (dump_page_end() < 0) break;
        if (done) break;
    }
    close(fd);
    return 0;
}

int main(int argc, char **argv) {
    if (argc != 3) {
        fprintf(stderr, "usage: %s <family 2|10> <protocol 6|17>\n", argv[0]);
        return 2;
    }
    int family = atoi(argv[1]);
    int protocol = atoi(argv[2]);
    if (family != AF_INET && family != AF_INET6) {
        fprintf(stderr, "unsupported family %d\n", family);
        return 2;
    }
    if (protocol != IPPROTO_TCP && protocol != IPPROTO_UDP) {
        fprintf(stderr, "unsupported protocol %d\n", protocol);
        return 2;
    }
    return dump(family, protocol);
}
