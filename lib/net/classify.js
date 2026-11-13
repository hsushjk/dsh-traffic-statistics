

const PRIVATE_V4 = [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['224.0.0.0', 4],

  ['100.64.0.0', 10],
  ['0.0.0.0', 8],
]

function ipv4ToUint(ip) {
  const parts = ip.split('.')
  if (parts.length !== 4) return undefined
  let n = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined
    const v = Number(part)
    if (v > 255) return undefined
    n = ((n << 8) | v) >>> 0
  }
  return n
}


export function isPrivateIpv4(ip) {
  const n = ipv4ToUint(ip)
  if (n === undefined) return false
  for (const [base, bits] of PRIVATE_V4) {
    const b = ipv4ToUint(base)
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    if ((n & mask) >>> 0 === (b & mask) >>> 0) return true
  }
  return false
}


export function ipv6Groups(ip) {
  let text = ip
  const zone = text.indexOf('%')
  if (zone >= 0) text = text.slice(0, zone)
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1)
  if (!text.includes(':')) return undefined
  let head = text
  let tail = ''
  const dbl = text.indexOf('::')
  if (dbl >= 0) {
    head = text.slice(0, dbl)
    tail = text.slice(dbl + 2)
  }
  const split = s => (s === '' ? [] : s.split(':'))
  const headParts = split(head)
  const tailParts = split(tail)
  const v4Tail = []
  const last = dbl >= 0 ? tailParts[tailParts.length - 1] : headParts[headParts.length - 1]
  if (last !== undefined && last.includes('.')) {
    const v4 = ipv4ToUint(last)
    if (v4 === undefined) return undefined
    v4Tail.push(v4 >>> 16, v4 & 0xffff)
    if (dbl >= 0) tailParts.pop()
    else headParts.pop()
  }
  const groups = []
  for (const part of headParts) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return undefined
    groups.push(Number.parseInt(part, 16))
  }
  if (dbl >= 0) {
    const tailNums = []
    for (const part of tailParts) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return undefined
      tailNums.push(Number.parseInt(part, 16))
    }
    const fill = 8 - groups.length - tailNums.length - v4Tail.length
    if (fill < 0) return undefined
    for (let i = 0; i < fill; i++) groups.push(0)
    groups.push(...tailNums)
  }
  groups.push(...v4Tail)
  if (groups.length !== 8) return undefined
  return groups
}


export function isPrivateIpv6(ip) {
  const g = ipv6Groups(ip)
  if (g === undefined) return false
  if (g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff) {
    const v4 = `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`
    return isPrivateIpv4(v4)
  }
  if (g.every(x => x === 0)) return true
  if (g.slice(0, 7).every(x => x === 0) && g[7] === 1) return true
  if ((g[0] & 0xfe00) === 0xfc00) return true
  if ((g[0] & 0xffc0) === 0xfe80) return true
  if ((g[0] & 0xff00) === 0xff00) return true
  return false
}


export function isPrivateAddress(ip) {
  if (typeof ip !== 'string' || ip === '') return true
  if (ip.includes(':')) return isPrivateIpv6(ip)





  if (/[a-zA-Z]/.test(ip)) return ip === 'localhost' || ip.endsWith('.localhost') || ip.endsWith('.local')
  return isPrivateIpv4(ip)
}


export function hostOfAuthority(authority) {
  if (typeof authority !== 'string') return ''
  let host = authority.trim()
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    return end > 0 ? host.slice(1, end) : host
  }
  const colon = host.lastIndexOf(':')
  if (colon > 0 && host.indexOf(':') === colon) host = host.slice(0, colon)
  return host
}


export function normalizeHost(host) {
  return hostOfAuthority(host).toLowerCase().replace(/\.$/, '')
}


export function splitHostPort(text) {
  if (typeof text !== 'string') return { address: '', port: 0 }
  const trimmed = text.trim()
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']')
    if (end > 0) {
      const port = Number(trimmed.slice(end + 1).replace(/^:/, ''))
      return { address: trimmed.slice(1, end), port: Number.isFinite(port) ? port : 0 }
    }
  }
  const colon = trimmed.lastIndexOf(':')
  if (colon < 0) return { address: trimmed, port: 0 }
  const port = Number(trimmed.slice(colon + 1))
  return { address: trimmed.slice(0, colon), port: Number.isFinite(port) ? port : 0 }
}
