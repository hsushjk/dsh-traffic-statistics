# dsh-traffic-statistics

[![DSH 插件](https://img.shields.io/badge/DeepSeek%20Harness%20Plugin-0078d6)]()
[![平台](https://img.shields.io/badge/Linux%20Only-fcc624)]()

DSH 进程树公网流量统计插件。直接监控 DSH 主进程及其子进程（Bash 工具、MCP 服务等）对外发出的 TCP/UDP 字节，过滤掉内网流量，把公网总流量按 **聊天 / 工具 / 插件 / 其它** 四类分账。

## 使用场景

上网成本高，需要辅助控制流量成本：漫游/星链/VSAT/海事

> 这是一套**统计/观测**工具，不是防火墙或限速器。它只读不拦截。有拦截审批需求请使用[dsh-net-consent](https://github.com/hsushjk/dsh-net-consent)]

## 实现

- **进程级总账**：通过内核 `inet_diag`（`tcp_info` 每连接字节计数）直接读取 DSH 进程树每个 socket 的真实收发字节，覆盖主进程、Worker 与所有 Bash 子进程。
- **TCP 精确、UDP 估算**：TCP 用 `tcpi_bytes_received` / `tcpi_bytes_acked` 精确计量；UDP 没有每连接字节计数，按「公网 UDP socket 数 × 512B」估算。
- **过滤内网**：私有地址（10/8、172.16/12、192.168/16、127/8、169.254/16、224/4、100.64/10、0/8）单独记为「局域网」，不计入。
- **四类分账**：
  - **聊天** — DSH 主进程（主要是大模型对话），再按大小启发式拆成「文字 / 媒体」（单次采样 > 64KB 判为媒体）。
  - **工具** — 工具子进程（`bash` / `curl` / `wget` 等）的公网流量，如 `web_fetch`、`web_search`。
  - **插件** — 插件子进程（`node` / `python` 常驻服务，如 `billion-context`、MCP）的公网流量。
  - **其它** — 识别不出归属的公网流量，按对端 `IP:端口` 展示。
- **产生者归因**：每个分账下再列出具体产生者——插件显示包名（从 `node_modules` 路径解析，如 `billion-context`），工具显示命令名（如 `curl`），其它显示对端 `IP:端口`。
- **动态采样**：默认每 5 秒采样一次；检测到有公网流量时自动降为 1 秒快采。
- **自动重启**：每日定点与 300MB RSS 阈值（可关，但不建议）。

## 使用

安装并重启 DSH 后，打开 **设置 → 流量统计** 即可看到面板。

## 运行要求

- **Linux**（依赖 `/proc`、`/sys/fs/cgroup` 与 `inet_diag`）。
- **内核 ≥ 4.18**（需要 `tcp_info` 的字节计数字段）。
- 首次运行需要 **C 编译器**（`cc` / `gcc` / `clang`）与内核头文件（`linux-libc-dev` / `kernel-headers`），用于编译 `lib/proc/netlink_dump.c`；编译产物缓存在数据目录，之后无需再编译。

> 常见发行版基本上都没什么问题。

## 接口

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/__trafficstat/report?range=run\|today\|month\|all` | GET | 总流量、四类分账、产生者、采样器状态 |
| `/__trafficstat/settings` | GET | 当前设置、数据目录、版本号 |
| `/__trafficstat/settings` | POST | 改设置（`enabled` / `accounting` / `autoRestart`） |

报告主要字段：

- `total` — `{ bytes, udp, lanBytes, formatted, source }`，公网总字节（TCP + UDP 估算），局域网单列不计入。
- `lanes` — `{ rows, grand, udp, lan, producers }`，四类分账明细与产生者。
- `sampler` — 采样器运行状态（`running` / `pid` / `passAgeMs` / `current.{ifaceBytes,publicBytes,udpEstimate,coverage}` 等）。
- `version` — 插件版本号（读自 `package.json`）。

## 配置

配置文件：`$DSH_HOME/traffic-statistics.json`（默认 `~/.dsh/traffic-statistics.json`），也可在设置面板直接改。

```jsonc
{
  "enabled": true,
  "accounting": {
    "enabled": true,
    "sampleIntervalMs": 5000,      // 采样间隔 1s–600s
    "sampleActiveIntervalMs": 1000 // 有流量时的快采间隔，须 ≤ sampleIntervalMs
  },
  "autoRestart": {
    "enabled": false,
    "dailyRestartAt": "04:00",     // 每日定点重启（HH:MM）
    "memoryLimitMb": 300           // RSS 阈值重启（32–65536 MB）
  }
}
```

## 数据目录

```
$DSH_HOME/plugins-data/dsh-traffic-statistics/
├── minutes.json      # 分钟桶（持久化分账数据）
└── sampler/
    ├── latest.json   # 采样器最近一次采样
    └── sampler.pid   # 采样器子进程 PID
```

清空统计数据的命令：

```bash
rm -rf ~/.dsh/plugins-data/dsh-traffic-statistics
```

## 已知限制

- 两次采样之间「瞬间建立并关闭」的连接会被漏掉（`inet_diag` 只能读到采样瞬间存活的 socket）；1 秒快采只是缩小窗口，无法完全消除。
- UDP 为粗略估算（socket 数 × 512B），不是精确字节。
- 聊天「文字 / 媒体」是按单次采样字节量的大小启发式，不是准确识别。
- 仅支持 Linux（内核 ≥ 4.18）；首次运行需要 C 编译器与内核头文件来编译 `lib/proc/netlink_dump.c`。
