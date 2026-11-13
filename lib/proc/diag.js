

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))


export const TCP_STATE_NAMES = ['', 'ESTABLISHED', 'SYN_SENT', 'SYN_RECV', 'FIN_WAIT1', 'FIN_WAIT2', 'TIME_WAIT', 'CLOSE', 'CLOSE_WAIT', 'LAST_ACK', 'LISTEN', 'CLOSING']


export function ensureHelper(options = {}) {
  if (process.platform !== 'linux') return { path: '', built: false, error: 'inet_diag is Linux-only' }
  const source = join(here, 'netlink_dump.c')
  const output = join(here, 'netlink_dump')
  if (!existsSync(source)) return { path: '', built: false, error: 'netlink_dump.c is missing from the install' }
  try {
    if (statSync(output).mtimeMs >= statSync(source).mtimeMs) return { path: output, built: false }
  } catch {}
  if (options.allowBuild === false) return { path: '', built: false, error: 'helper binary not built' }
  const builder = ['cc', 'gcc', 'clang'].find(compiler => spawnSyncOk(compiler, ['-O2', '-o', output, source]))
  if (builder === undefined) return { path: '', built: false, error: 'no working C compiler (cc/gcc/clang) to build the inet_diag helper' }
  return { path: output, built: true }
}


function spawnSyncOk(file, args) {
  const result = spawnSync(file, args, { timeout: 30_000, stdio: 'ignore' })
  return result.status === 0
}


function runWithInput(file, args, input, timeoutMs) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ ok: false, stdout, error: `timed out after ${String(timeoutMs)}ms` })
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', error => finish({ ok: false, stdout, error: error.message }))
    child.on('close', (code) => {
      if (code === 0) finish({ ok: true, stdout })
      else finish({ ok: false, stdout, error: `exited ${String(code)}${stderr !== '' ? `: ${stderr.trim()}` : ''}` })
    })
    child.stdin.end(input)
  })
}


export function parseHelperPage(chunk) {
  const sockets = []
  for (const line of chunk.split('\n')) {
    if (line.trim() === '') continue
    const f = line.trimEnd().split('\t')


    if (f.length === 9) f.push('-1', '-1')
    if (f.length < 11) continue
    const bytesRecv = Number(f[9])
    const bytesSent = Number(f[10])
    sockets.push({
      netid: f[0],
      family: Number(f[1]),
      state: Number(f[2]),
      localPort: Number(f[3]),
      local: `${f[4]}:${f[3]}`,
      remotePort: Number(f[5]),
      remote: `${f[6]}:${f[5]}`,
      uid: Number(f[7]),
      inode: Number(f[8]),
      bytesRecv: Number.isFinite(bytesRecv) && bytesRecv >= 0 ? bytesRecv : 0,
      bytesSent: Number.isFinite(bytesSent) && bytesSent >= 0 ? bytesSent : 0,
      counters: bytesRecv >= 0 || bytesSent >= 0,
    })
  }
  return sockets
}


export async function dumpSockets(options) {
  const helper = typeof options.helper === 'string' ? options.helper : ensureHelper().path
  if (helper === '' || helper === undefined) return { ok: false, sockets: [], stats: [], error: 'inet_diag helper unavailable' }
  const specs = [
    { family: 2, protocol: 6 },
    { family: 10, protocol: 6 },
    { family: 2, protocol: 17 },
    { family: 10, protocol: 17 },
  ]
  const sockets = []
  const stats = []
  for (const spec of specs) {
    const result = await dumpOne(helper, spec, options)
    stats.push(result.stat)
    if (result.error !== undefined && sockets.length === 0 && result.stat.total === 0) {
      return { ok: false, sockets, stats, error: result.error }
    }
    sockets.push(...result.sockets)
  }
  return { ok: true, sockets, stats }
}


function dumpOne(helper, spec, options) {
  return new Promise((resolve) => {
    const stat = { family: spec.family, protocol: spec.protocol, kept: 0, total: 0, pages: 0, stopped: false }
    const kept = []
    let buffer = ''
    let settled = false
    const netid = spec.protocol === 6 ? 'tcp' : 'udp'
    const child = spawn(helper, [`${String(spec.family)}`, `${String(spec.protocol)}`], { stdio: ['ignore', 'pipe', 'pipe'] })
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ sockets: kept, stat, error })
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(`dump timed out after ${String(options.timeoutMs ?? 4000)}ms`)
    }, options.timeoutMs ?? 4000)
    const consume = (final) => {
      const lines = buffer.split('\n')
      buffer = final ? '' : (lines.pop() ?? '')
      for (const line of lines) {
        if (line === '--page') {
          stat.pages++
          options.onPage?.({ family: spec.family, protocol: spec.protocol, kept: stat.kept, total: stat.total, pages: stat.pages })


          if (stat.total > 200 && stat.kept * 2 < stat.total) {
            stat.stopped = true
            child.kill('SIGTERM')
          }
          continue
        }
        for (const socket of parseHelperPage(line)) {
          stat.total++
          if (options.want(socket)) {
            stat.kept++
            kept.push(socket)
          }
        }
      }
    }
    child.stdout.on('data', (chunk) => {
      buffer += String(chunk)
      if (!settled) consume(false)
    })
    child.on('error', error => finish(error.message))
    child.on('close', () => {
      if (!settled) consume(true)
      finish(undefined)
    })
    void netid
  })
}


export async function dumpAllSockets(options = {}) {
  return dumpSockets({ want: () => true, timeoutMs: options.timeoutMs })
}
