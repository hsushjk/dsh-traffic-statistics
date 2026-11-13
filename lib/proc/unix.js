

import { execFile } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, readlinkSync, statSync } from 'node:fs'


export function run(file, args, timeoutMs = 15_000) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) resolve({ ok: false, stdout: stdout ?? '', error: `${error.message}${stderr ? `: ${stderr}` : ''}` })
      else resolve({ ok: true, stdout: stdout ?? '' })
    })
  })
}


const SKIPPED_IFACE = /^(lo|virbr\d*|docker\d*|veth.*|br-.*|vboxnet\d*|vmnet\d*|tun\d*|tap\d*)$/


export function parseNetDev(text) {
  const interfaces = []
  for (const line of text.split('\n').slice(2)) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const name = line.slice(0, colon).trim()
    if (SKIPPED_IFACE.test(name)) continue
    const cols = line.slice(colon + 1).trim().split(/\s+/).map(Number)
    if (cols.length < 9) continue
    const [rx, tx] = [cols[0], cols[8]]
    if (!Number.isFinite(rx) || !Number.isFinite(tx)) continue
    interfaces.push({ name, rx, tx })
  }
  const rx = interfaces.reduce((sum, iface) => sum + iface.rx, 0)
  const tx = interfaces.reduce((sum, iface) => sum + iface.tx, 0)
  return { rx, tx, interfaces, available: interfaces.length > 0 }
}


export async function readInterfaceCounters() {
  if (process.platform !== 'linux') return { rx: 0, tx: 0, interfaces: [], available: false, error: 'not Linux' }
  try {
    return parseNetDev(readFileSync('/proc/net/dev', 'utf8'))
  } catch (error) {
    return { rx: 0, tx: 0, interfaces: [], available: false, error: String(error) }
  }
}


export function parseProcAddress(cell, v6) {
  const [addr, portText] = cell.split(':')
  const port = Number.parseInt(portText, 16)
  if (!v6) {
    const n = Number.parseInt(addr, 16) >>> 0
    return { address: [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff].join('.'), port: Number.isFinite(port) ? port : 0 }
  }
  const words = []
  for (let i = 0; i < 32; i += 8) {
    const n = Number.parseInt(addr.slice(i, i + 8), 16) >>> 0
    words.push((n & 0xff).toString(16).padStart(2, '0'), ((n >>> 8) & 0xff).toString(16).padStart(2, '0'), ((n >>> 16) & 0xff).toString(16).padStart(2, '0'), ((n >>> 24) & 0xff).toString(16).padStart(2, '0'))
  }
  const groups = []
  for (let i = 0; i < words.length; i += 4) groups.push(words.slice(i, i + 4).join(''))

  let bestStart = -1
  let bestLen = 1
  let start = -1
  for (let i = 0; i <= groups.length; i++) {
    const zero = i < groups.length && /^0+$/.test(groups[i])
    if (zero && start < 0) start = i
    if (!zero && start >= 0) {
      const len = i - start
      if (len > bestLen) {
        bestLen = len
        bestStart = start
      }
      start = -1
    }
  }
  const hexes = groups.map(g => g.replace(/^0+(?=.)/, ''))
  const address = bestStart >= 0 ? `${hexes.slice(0, bestStart).join(':')}::${hexes.slice(bestStart + bestLen).join(':')}` : hexes.join(':')
  return { address, port: Number.isFinite(port) ? port : 0 }
}

const TCP_STATES = ['', 'ESTABLISHED', 'SYN_SENT', 'SYN_RECV', 'FIN_WAIT1', 'FIN_WAIT2', 'TIME_WAIT', 'CLOSE', 'CLOSE_WAIT', 'LAST_ACK', 'LISTEN', 'CLOSING']


export function parseProcTable(text, netid, v6) {
  const rows = []
  for (const line of text.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 10) continue
    const local = parseProcAddress(cols[1], v6)
    const remote = parseProcAddress(cols[2], v6)
    const code = Number.parseInt(cols[3], 16)
    const state = netid === 'tcp' ? (TCP_STATES[code] ?? 'UNKNOWN') : (code === 7 ? 'UNCONN' : 'ESTAB')
    rows.push({
      netid,
      inode: cols[9],
      local: `${local.address}:${local.port}`,
      remote: `${remote.address}:${remote.port}`,
      state: state === '' ? 'UNKNOWN' : state,
      localPort: local.port,
      remotePort: remote.port,
    })
  }
  return rows
}


export function readProcSockets() {
  const map = new Map()
  const files = [
    ['tcp', false, '/proc/net/tcp'],
    ['tcp', true, '/proc/net/tcp6'],
    ['udp', false, '/proc/net/udp'],
    ['udp', true, '/proc/net/udp6'],
  ]
  for (const [netid, v6, path] of files) {
    if (!existsSync(path)) continue
    let text
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    for (const row of parseProcTable(text, netid, v6)) {
      if (row.inode !== '0') map.set(row.inode, row)
    }
  }
  return map
}


export function readPpid(pid) {
  let text
  try {
    text = readFileSync(`/proc/${String(pid)}/stat`, 'utf8')
  } catch {
    return undefined
  }
  const tail = text.slice(text.lastIndexOf(')') + 2).split(' ')
  const ppid = Number(tail[1])
  return Number.isFinite(ppid) ? ppid : undefined
}


export function readTree(rootPid, options = {}) {
  const exclude = new Set(options.exclude ?? [])
  const pids = new Set([rootPid])
  let needle = options.needle
  let cgroupDir
  if (needle === undefined) {
    try {
      needle = readFileSync(`/proc/${String(rootPid)}/cgroup`, 'utf8').split('\n').find(line => line.startsWith('0::'))?.slice(3)
      if (needle !== undefined) cgroupDir = `/sys/fs/cgroup${needle}`
    } catch {}
  }
  const sources = ['root']
  if (needle !== undefined && needle !== '/') {
    for (const pid of pidsInCgroupPath(needle)) pids.add(pid)
    sources.push('cgroup')
  }
  const children = descendantsOf(rootPid)
  for (const pid of children) pids.add(pid)
  sources.push('ppid')
  for (const pid of exclude) pids.delete(pid)


  return { pids: [...pids], children, source: sources.join('+'), cgroupDir }
}


export function descendantsOf(rootPid) {
  const children = new Map()
  let entries
  try {
    entries = readdirSync('/proc', { withFileTypes: true })
  } catch {
    return []
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry.name)) continue
    const pid = Number(entry.name)
    if (pid === rootPid) continue
    const ppid = readPpid(pid)
    if (ppid === undefined) continue
    const list = children.get(ppid)
    if (list === undefined) children.set(ppid, [pid])
    else list.push(pid)
  }
  const found = []
  const queue = [rootPid]
  const seen = new Set([rootPid])
  while (queue.length > 0) {
    const current = queue.shift()
    for (const child of children.get(current) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      found.push(child)
      queue.push(child)
    }
  }
  return found
}


export function pidsInCgroupPath(needle) {
  const found = []
  let entries
  try {
    entries = readdirSync('/proc', { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry.name)) continue
    let text
    try {
      text = readFileSync(`/proc/${entry.name}/cgroup`, 'utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      if (!line.startsWith('0::')) continue
      const path = line.slice(3)
      if (path === needle || path.startsWith(`${needle}/`)) {
        found.push(Number(entry.name))
        break
      }
    }
  }
  return found
}


export function readComm(pids) {
  const names = new Map()
  for (const pid of pids) {
    try {
      names.set(pid, readFileSync(`/proc/${String(pid)}/comm`, 'utf8').trim())
    } catch {}
  }
  return names
}


export function readExeNames(pids) {
  const names = new Map()
  for (const pid of pids) {
    try {
      const target = readlinkSync(`/proc/${String(pid)}/exe`)
      names.set(pid, target.slice(target.lastIndexOf('/') + 1))
    } catch {}
  }
  return names
}


export function readCmdline(pids) {
  const map = new Map()
  for (const pid of pids) {
    try {
      const raw = readFileSync(`/proc/${String(pid)}/cmdline`, 'utf8')
      const argv = raw.split('\0').filter(s => s.length > 0)
      if (argv.length > 0) map.set(pid, argv.join(' ').slice(0, 512))
    } catch {}
  }
  return map
}


export function readInodeOwners(pids) {
  const owners = new Map()
  for (const pid of pids) {
    let fds
    try {
      fds = readdirSync(`/proc/${String(pid)}/fd`)
    } catch {
      continue
    }
    for (const fd of fds) {
      let target
      try {
        target = readlinkSync(`/proc/${String(pid)}/fd/${fd}`)
      } catch {
        continue
      }
      if (!target.startsWith('socket:[')) continue
      const inode = target.slice(8, -1)
      const list = owners.get(inode)
      if (list === undefined) owners.set(inode, [pid])
      else if (!list.includes(pid)) list.push(pid)
    }
  }
  return owners
}


function readCgroupFile(dir, file) {
  if (dir === undefined) return undefined
  try {
    return readFileSync(`${dir}/${file}`, 'utf8').trim()
  } catch {
    return undefined
  }
}


export function readCgroupUsage(dir) {
  if (dir === undefined) return { cpuUsec: null, memoryBytes: null, source: 'unavailable' }
  const cpu = readCgroupFile(dir, 'cpu.stat')
  const memory = readCgroupFile(dir, 'memory.current')
  const usage = cpu === undefined ? undefined : /usage_usec\s+(\d+)/.exec(cpu)?.[1]
  return {
    cpuUsec: usage === undefined ? null : Number(usage),
    memoryBytes: memory === undefined ? null : Number(memory),
    source: cpu === undefined && memory === undefined ? 'unavailable' : 'cgroup-v2',
  }
}


export function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}
