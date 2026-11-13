

import { classifySocket, accountWindow, laneForProcess, pluginNameOf, chatSubKind, PLUGIN_COMMS } from '../net/accounting.js'
import { splitHostPort } from '../net/classify.js'
import { pairLoopback } from '../net/pairing.js'
import { dumpSockets, ensureHelper, TCP_STATE_NAMES } from './diag.js'
import {
  readCgroupUsage,
  readCmdline,
  readComm,
  readExeNames,
  readInodeOwners,
  readInterfaceCounters,
  readPpid,
  readProcSockets,
  readTree,
} from './unix.js'


const TCP_LISTEN = 10

const UDP_UNCONN = 7


export function peerKey(text) {
  const { address, port } = splitHostPort(text)
  return port > 0 ? `${address}:${String(port)}` : address
}


export function socketDeltas(row, before, hasPrevPass) {
  const beforeRecv = before?.rawRecv ?? before?.bytesRecv
  const beforeSent = before?.rawSent ?? before?.bytesSent


  const reset = before !== undefined && (row.bytesRecv < beforeRecv || row.bytesSent < beforeSent)


  const hasBaseline = before !== undefined && hasPrevPass
  const recv = Math.max(0, !hasBaseline || reset ? row.bytesRecv * (hasBaseline ? 1 : 0) : row.bytesRecv - beforeRecv)
  const sent = Math.max(0, !hasBaseline || reset ? row.bytesSent * (hasBaseline ? 1 : 0) : row.bytesSent - beforeSent)
  return { recv, sent }
}


export function resolvePluginProducer(entry, perProcess, rootPid) {
  const direct = pluginNameOf(entry.cmdline, entry.name)
  if (!PLUGIN_COMMS.has(String(direct ?? '').toLowerCase())) return direct
  let p = entry.ppid
  const visited = new Set([entry.pid])
  while (p !== undefined && p !== rootPid && !visited.has(p)) {
    visited.add(p)
    const parent = perProcess.get(p)
    if (parent === undefined) break
    const parentName = pluginNameOf(parent.cmdline, parent.name)
    if (!PLUGIN_COMMS.has(String(parentName ?? '').toLowerCase())) return parentName
    p = parent.ppid
  }
  return direct
}




async function readSocketRows(ctx, inodeOwners, procSockets, names) {
  const helper = ensureHelper()
  if (helper.path !== '') {
    const dump = await dumpSockets({ helper: helper.path, timeoutMs: ctx.dumpTimeoutMs, want: () => true })
    if (dump.ok && dump.sockets.length > 0) {
      const rows = dump.sockets.map((socket) => {
        const owners = inodeOwners.get(String(socket.inode)) ?? []
        const procRow = procSockets.get(String(socket.inode))
        return {
          key: `${socket.netid}|${socket.local}>${socket.remote}|${String(socket.inode)}`,
          netid: socket.netid,
          stateNum: socket.state,
          state: TCP_STATE_NAMES[socket.state] ?? String(socket.state),
          local: socket.local,
          remote: socket.remote,
          inode: socket.inode,
          owners,
          bytesRecv: socket.bytesRecv,
          bytesSent: socket.bytesSent,
          counters: socket.counters !== false,
          process: owners.map(pid => names.get(pid) ?? String(pid)).join(',') || '-',
          listening: socket.state === TCP_LISTEN || procRow?.state === 'LISTEN' || procRow?.state === 'UNCONN',
        }
      })
      return { rows, source: 'inet_diag (per-socket tcp_info counters)', helper }
    }
    const failure = dump.ok ? 'empty dump' : (dump.error ?? 'unknown')
    return { rows: readProcRows(inodeOwners, procSockets, names), source: `proc (/proc/net: shape only; inet_diag failed: ${failure})`, helper }
  }
  return { rows: readProcRows(inodeOwners, procSockets, names), source: `proc (/proc/net: shape only; helper unavailable: ${helper.error ?? 'unknown'})`, helper }
}


function readProcRows(inodeOwners, procSockets, names) {
  const rows = []
  for (const [inode, row] of procSockets) {
    const owners = inodeOwners.get(String(inode)) ?? []
    rows.push({
      key: `${row.netid}|${row.local}>${row.remote}|${inode}`,
      netid: row.netid,
      stateNum: row.state === 'LISTEN' ? TCP_LISTEN : (row.netid === 'udp' ? UDP_UNCONN : 1),
      state: row.state ?? '-',
      local: row.local,
      remote: row.remote,
      inode: Number(inode),
      owners,
      bytesRecv: 0,
      bytesSent: 0,
      counters: false,
      process: owners.map(pid => names.get(pid) ?? String(pid)).join(',') || '-',
      listening: row.state === 'LISTEN' || row.state === 'UNCONN',
    })
  }
  return rows
}


export async function sample(ctx, prev) {
  const startedAt = ctx.now()
  const sources = {}

  const tree = readTree(ctx.rootPid, { needle: ctx.cgroupPath, exclude: ctx.excludePid })
  sources.tree = tree.source
  const pids = tree.pids
  const names = readComm(pids)
  const exe = readExeNames(pids)
  const cmdlines = readCmdline(pids)
  const inodeOwners = readInodeOwners(pids)
  const procSockets = readProcSockets()
  const treeListenPorts = new Set()
  for (const [inode, row] of procSockets) {
    if (row.state !== 'LISTEN' || !inodeOwners.has(inode)) continue
    treeListenPorts.add(String(row.localPort))
  }

  const { rows, source, helper } = await readSocketRows(ctx, inodeOwners, procSockets, names)
  sources.sockets = source
  sources.helper = helper.path === '' ? 'unavailable' : (helper.built ? 'compiled now' : 'cached')

  const prevSockets = new Map()
  for (const row of prev?.sockets ?? []) prevSockets.set(row.key, row)

  const decisions = rows.map((row) => {
    if (typeof row.local !== 'string' || typeof row.remote !== 'string') {


      row.broken = true
    }
    const local = splitHostPort(row.local)
    const remote = splitHostPort(row.remote)
    const c = classifySocket({
      netid: row.netid,
      state: row.stateNum,
      local,
      remote,
      owners: row.owners,
      listening: row.listening,
      treeListenPorts,
    })
    return { row, family: c.family, reason: c.reason, local, remote }
  })
  const pairing = pairLoopback(decisions.filter(d => d.row.broken !== true).map(d => ({ ...d.row })), new Set(pids))

  const families = {}
  const lanes = {}
  const producers = {}
  let udpPublicSockets = 0
  const children = new Set(tree.children ?? [])
  const ppids = new Map()
  for (const pid of pids) {
    const ppid = readPpid(pid)
    if (ppid !== undefined) ppids.set(pid, ppid)
  }
  const perProcess = new Map()
  for (const pid of pids) {
    perProcess.set(pid, {
      pid,
      name: exe.get(pid) ?? names.get(pid) ?? '?',
      cmdline: cmdlines.get(pid) ?? '',
      ppid: ppids.get(pid),


      main: pid === ctx.rootPid,
      child: children.has(pid),
      bytesRecv: 0,
      bytesSent: 0,
      byPeer: {},
    })
  }
  const current = []
  const seen = new Set()
  const forwardedByPeer = {}
  const byReason = {}
  let forwarded = 0
  for (const decision of decisions) {
    const { row } = decision
    if (row.broken === true) continue
    const resolution = pairing.bySocket.get(row.key)
    const family = resolution?.family ?? decision.family
    const reason = resolution?.reason ?? decision.reason
    seen.add(row.key)

    const before = prevSockets.get(row.key)
    const { recv, sent } = socketDeltas(row, before, prev?.at !== undefined)
    byReason[reason] = (byReason[reason] ?? 0) + recv + sent





    current.push({ key: row.key, netid: row.netid, local: row.local, remote: row.remote, family, reason, bytesRecv: recv, bytesSent: sent, rawRecv: row.bytesRecv, rawSent: row.bytesSent, owners: row.owners, process: row.process })
    if (recv === 0 && sent === 0 && !family.startsWith('net-')) continue

    if (family === 'forwarded') {
      forwarded += recv + sent
      const peer = peerKey(row.remote)
      forwardedByPeer[peer] = (forwardedByPeer[peer] ?? 0) + recv + sent
    } else if (family === 'net-tcp' || family === 'net-udp') {
      const bucket = (families[family] ??= { bytesRecv: 0, bytesSent: 0, byPeer: {} })
      bucket.bytesRecv += recv
      bucket.bytesSent += sent
      const peer = peerKey(row.remote)
      bucket.byPeer[peer] = (bucket.byPeer[peer] ?? 0) + recv + sent

      const lane = (() => {
        for (const pid of row.owners) {
          const entry = perProcess.get(pid)
          if (entry === undefined) continue
          return laneForProcess(entry.name, entry.main)
        }
        return 'other'
      })()
      lanes[lane] = (lanes[lane] ?? 0) + recv + sent
      if (family === 'net-udp') udpPublicSockets++



      const producer = (() => {
        if (lane === 'chat') return chatSubKind(recv + sent)
        for (const pid of row.owners) {
          const entry = perProcess.get(pid)
          if (entry === undefined) continue
          if (lane === 'tools') return entry.name || 'tool'
          if (lane === 'plugins') return resolvePluginProducer(entry, perProcess, ctx.rootPid)
          return peer || 'unknown'
        }
        return lane === 'tools' ? 'tool' : lane === 'plugins' ? 'plugin' : (peer || 'unknown')
      })()
      if (producer !== null) {
        const laneMap = (producers[lane] ??= {})
        laneMap[producer] = (laneMap[producer] ?? 0) + recv + sent
      }
      for (const pid of row.owners) {
        const entry = perProcess.get(pid)
        if (entry === undefined) continue
        entry.bytesRecv += recv
        entry.bytesSent += sent
        entry.byPeer[peer] = (entry.byPeer[peer] ?? 0) + recv + sent
      }
    } else if (family === 'lan' || family === 'ctx-private') {
      const bucket = (families['ctx-private'] ??= { bytesRecv: 0, bytesSent: 0, byPeer: {} })
      bucket.bytesRecv += recv
      bucket.bytesSent += sent
    }
  }

  let disappeared = 0
  for (const [key] of prevSockets) if (!seen.has(key)) disappeared++

  const iface = await readInterfaceCounters()
  sources.interface = iface.available ? `proc-net-dev: ${iface.interfaces.map(i => i.name).join(',')}, lo and virtual bridges excluded` : 'unavailable'
  const ifaceDelta = prev === undefined ? { rx: 0, tx: 0 } : { rx: Math.max(0, iface.rx - Number(prev.interface.rx)), tx: Math.max(0, iface.tx - Number(prev.interface.tx)) }



  const udpEstimate = udpPublicSockets * 512
  const window = accountWindow(ifaceDelta, families, { udpEstimate })
  const cgroup = readCgroupUsage(tree.cgroupDir)
  sources.cgroup = cgroup.source



  const periodMs = prev === undefined ? 0 : Math.max(0, ctx.now() - prev.at)

  return {
    at: ctx.now(),
    periodMs,
    pidSource: tree.source,
    cgroupPath: ctx.cgroupPath ?? null,
    pids,
    processes: [...perProcess.values()].filter(p => p.bytesRecv + p.bytesSent > 0),
    childPids: [...children],
    interface: { rx: iface.rx, tx: iface.tx, interfaces: iface.interfaces },
    sockets: current,
    families,
    lanes,
    producers,
    udpPublicSockets,
    window: { ...window, byReason },
    pairing: { pairs: pairing.pairs.length, resolved: [...pairing.bySocket.values()].filter(r => r.family !== 'lan').length },
    disappeared,
    cgroup: { cpuUsec: cgroup.cpuUsec, memoryBytes: cgroup.memoryBytes },
    sources,
    durationMs: ctx.now() - startedAt,
  }
}
