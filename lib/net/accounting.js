

import { isPrivateAddress } from './classify.js'


export const BYTE_FAMILIES = ['net-tcp', 'net-udp']


export const LANE_ORDER = ['chat', 'tools', 'plugins', 'other']


export const LANE_LABELS = {
  chat: '聊天',
  tools: '工具',
  plugins: '插件',
  other: '其它',
}


export const LANE_NOTES = {
  chat: 'DSH 主进程的公网流量（主要是大模型对话）',
  tools: '工具子进程（bash / curl / wget 等）的公网流量，如 web_fetch、web_search',
  plugins: '插件子进程（node / python 常驻服务，如 billion-context、MCP）的公网流量',
  other: '识别不出归属的公网流量',
}


const TOOL_COMMS = new Set(['bash', 'sh', 'dash', 'zsh', 'curl', 'wget', 'git', 'npm', 'npx', 'pip', 'pip3'])


export const PLUGIN_COMMS = new Set(['node', 'nodejs', 'deno', 'bun', 'python', 'python2', 'python3'])


export function laneForProcess(name, main) {
  if (main) return 'chat'
  const n = String(name ?? '').toLowerCase().split('/').pop()
  if (TOOL_COMMS.has(n)) return 'tools'
  if (PLUGIN_COMMS.has(n)) return 'plugins'
  return 'other'
}


export const CHAT_MEDIA_THRESHOLD = 64 * 1024


export const CHAT_SUB_LABELS = { text: '文字', media: '媒体' }


export function chatSubKind(delta) {
  return Number(delta) > CHAT_MEDIA_THRESHOLD ? CHAT_SUB_LABELS.media : CHAT_SUB_LABELS.text
}


export function pluginNameOf(cmdline, fallback) {
  if (typeof cmdline === 'string' && cmdline !== '') {

    const pkg = cmdline.match(/node_modules\/(@[^/\s]+\/[^/\s]+|[^/\s]+)/)
    if (pkg) return pkg[1]



    const argv = cmdline.split(/\s+/)
    for (let i = 1; i < argv.length; i++) {
      const arg = argv[i]
      if (arg === '' || arg.startsWith('-')) {


        if (/^--?(e|eval|c|command|p)$/.test(arg)) i++
        continue
      }
      if (/\.(js|mjs|cjs|py|ts)$/.test(arg) || arg.startsWith('/') || arg.startsWith('./') || arg.startsWith('../') || arg.startsWith('~/')) {
        return arg.split('/').pop().replace(/\.(js|mjs|cjs|py|ts)$/, '')
      }
    }
  }
  return fallback || 'plugin'
}


export const REASONS = {

  tree: 'tree',

  lan: 'lan',

  stranger: 'stranger',

  listening: 'listening',

  accessPoint: 'access-point',

  noise: 'noise',
}


export function classifySocket(args) {
  const tcp = args.netid !== 'udp'
  const peerPublic = !isPrivateAddress(args.remote.address)
  const owned = args.owners.length > 0
  if (args.listening) {
    return { family: 'ctx-listening', reason: owned ? REASONS.listening : REASONS.stranger, peerPublic }
  }
  if (!peerPublic) {

    const unroutable = args.remote.address === '0.0.0.0' || args.remote.address === '::' || args.remote.port === 0
    if (!owned) return { family: 'ctx-other', reason: REASONS.stranger, peerPublic }
    if (unroutable) return { family: 'ctx-other', reason: REASONS.noise, peerPublic }
    return { family: 'ctx-private', reason: REASONS.lan, peerPublic }
  }
  if (!owned) {
    return { family: 'ctx-other', reason: REASONS.stranger, peerPublic }
  }
  if (args.treeListenPorts?.has(String(args.local.port)) === true) {
    return { family: 'ctx-other', reason: REASONS.accessPoint, peerPublic }
  }
  return { family: tcp ? 'net-tcp' : 'net-udp', reason: REASONS.tree, peerPublic }
}


export function accountWindow(iface, families, options = {}) {
  const publicBytes = BYTE_FAMILIES.reduce((sum, family) => sum + (families[family]?.bytesRecv ?? 0) + (families[family]?.bytesSent ?? 0), 0)
  const ifaceBytes = Math.max(0, iface.rx) + Math.max(0, iface.tx)
  const lanBytes = (families['ctx-private']?.bytesRecv ?? 0) + (families['ctx-private']?.bytesSent ?? 0)
  const udpEstimate = Math.max(0, options.udpEstimate ?? 0)
  return {
    ifaceBytes,
    publicBytes,
    udpEstimate,
    totalBytes: publicBytes + udpEstimate,
    lanBytes,
    coverage: ifaceBytes > 0 ? Math.min(publicBytes / ifaceBytes, 1) : null,
  }
}
