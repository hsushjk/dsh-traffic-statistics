

import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sample } from './passes.js'


export function parseArgs(argv) {

  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const eq = arg.indexOf('=')
    if (eq > 0) out[arg.slice(2, eq)] = arg.slice(eq + 1)
    else out[arg.slice(2)] = argv[++i] ?? ''
  }
  return out
}


export async function runSampler(options) {
  const now = options.now ?? (() => Date.now())
  const ctx = {
    rootPid: options.rootPid,
    cgroupPath: options.cgroupPath,
    excludePid: [...(options.excludePid ?? []), process.pid],
    intervalMs: options.intervalMs,
    dumpTimeoutMs: options.dumpTimeoutMs,
    now,
  }
  let prev
  let stopping = false
  options.signal?.addEventListener('abort', () => { stopping = true })
  while (!stopping) {
    const pass = await sample(ctx, prev)
    if (ctx.cgroupPath === undefined && typeof pass.cgroupPath === 'string') ctx.cgroupPath = pass.cgroupPath
    prev = pass
    options.onPass?.(pass)
    try {
      const temp = join(options.outDir, `latest.${String(process.pid)}.json`)
      writeFileSync(temp, JSON.stringify(pass))
      renameSync(temp, join(options.outDir, 'latest.json'))
    } catch (error) {
      try {
        writeFileSync(join(options.outDir, 'sampler-error.txt'), `${new Date(now()).toISOString()} ${String(error?.stack ?? error)}\n`)
      } catch {}
    }
    if (options.once === true) return


    const busy = (pass.window?.publicBytes ?? 0) > 0
    const interval = Math.max(250, busy ? (options.activeIntervalMs ?? options.intervalMs) : options.intervalMs)
    const until = now() + interval
    while (!stopping && now() < until) {
      await new Promise(resolve => setTimeout(resolve, Math.min(200, Math.max(1, until - now()))))
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.out === undefined) {
    process.stderr.write('[traffic-sampler] --out <dir> is required\n')
    process.exit(2)
  }
  if (args['pid-file'] !== undefined) {
    try {
      writeFileSync(args['pid-file'], String(process.pid))
    } catch {}
  }
  const controller = new AbortController()
  process.on('SIGTERM', () => controller.abort())
  process.on('SIGINT', () => controller.abort())
  await runSampler({
    rootPid: Number(args['root-pid'] ?? process.ppid),
    outDir: args.out,
    cgroupPath: args.cgroup,
    intervalMs: Math.max(250, Number(args.interval ?? 5000)),
    activeIntervalMs: args.active === undefined ? undefined : Math.max(250, Number(args.active)),
    ledgerDir: args['ledger-dir'],
    once: args.once !== undefined,
    signal: controller.signal,
  })
  try {
    rmSync(join(args.out, `latest.${String(process.pid)}.json`), { force: true })
  } catch {}
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    process.stderr.write(`[traffic-sampler] fatal: ${error?.stack ?? String(error)}\n`)
    process.exit(1)
  })
}
