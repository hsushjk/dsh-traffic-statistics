

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
export const SAMPLER_PATH = join(HERE, 'sampler.js')


export function residentBytes(pid) {
  try {
    const status = readFileSync(`/proc/${String(pid)}/status`, 'utf8')
    const match = /VmRSS:\s+(\d+)\s+kB/.exec(status)
    if (match === null) return undefined
    return Number(match[1]) * 1024
  } catch {
    return undefined
  }
}


export function msUntilClock(clock, from = new Date()) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock)
  if (match === null) return 24 * 60 * 60 * 1000
  const target = new Date(from.getTime())
  target.setHours(Number(match[1]), Number(match[2]), 0, 0)
  if (target.getTime() <= from.getTime()) target.setDate(target.getDate() + 1)
  return target.getTime() - from.getTime()
}


export class SamplerSupervisor {
  constructor(options) {
    this.options = options
    this.log = options.log ?? (() => {})
    this.child = undefined
    this.generation = 0
    this.starts = 0
    this.restarts = []
    this.timer = undefined
    this.stopped = false
    this.lastExit = undefined
    this.stderrTail = ''
  }


  start() {
    if (this.stopped) return
    if (this.child !== undefined && this.child.exitCode === null && this.child.signalCode === null) {
      this.arm()
      return
    }
    this.generation++
    mkdirSync(this.options.outDir, { recursive: true })
    const args = [
      SAMPLER_PATH,
      '--out', this.options.outDir,
      '--root-pid', String(this.options.rootPid),
      '--interval', String(this.options.intervalMs),
      '--active', String(this.options.activeIntervalMs),
      '--pid-file', join(this.options.outDir, 'sampler.pid'),
    ]
    if (this.options.ledgerDir !== undefined) args.push('--ledger-dir', this.options.ledgerDir)
    const child = spawn(process.execPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: this.options.env ?? process.env,
      detached: false,
    })
    this.child = child
    this.starts++
    this.lastStartAt = Date.now()
    this.stderrTail = ''
    child.stderr?.on('data', (chunk) => {
      this.stderrTail = (this.stderrTail + String(chunk)).slice(-2000)
    })
    child.on('exit', (code, signal) => {
      this.lastExit = { at: Date.now(), code, signal, generation: this.generation }
      if (this.child === child) this.child = undefined
      if (this.stopped) return
      this.log(`sampler child exited (code ${String(code)}, signal ${String(signal)}); respawning`)


      setTimeout(() => this.start(), 2000).unref()
    })
    this.log(`sampler child started (generation ${String(this.generation)}, pid ${String(child.pid)})`)
    this.arm()
  }

  arm() {
    if (this.timer !== undefined) clearTimeout(this.timer)
    const every = this.options.checkMs ?? 30_000
    this.timer = setTimeout(() => this.check(), every)
    this.timer.unref?.()
  }


  check() {
    if (this.stopped) return
    const policy = this.options.autoRestart
    const pid = this.child?.pid
    if (policy.enabled) {
      const rss = pid === undefined ? undefined : residentBytes(pid)
      if (rss !== undefined && rss > policy.memoryLimitMb * 1024 * 1024) {
        this.restart(`memory ${String(Math.round(rss / 1024 / 1024))} MB over the ${String(policy.memoryLimitMb)} MB limit`)
        return
      }
      const lastStart = this.lastStartAt ?? 0
      const next = msUntilClock(policy.dailyRestartAt, new Date(lastStart))
      if (lastStart > 0 && Date.now() >= lastStart + next) {
        this.restart(`daily restart at ${policy.dailyRestartAt}`)
        return
      }
    }

    if (pid === undefined) this.start()
    else this.arm()
  }

  restart(reason) {
    this.restarts.push({ at: Date.now(), reason })
    if (this.restarts.length > 20) this.restarts.splice(0, this.restarts.length - 20)
    this.log(`restarting sampler: ${reason}`)
    const child = this.child
    this.child = undefined
    if (child !== undefined) {
      try { child.kill('SIGTERM') } catch {}

      const forced = setTimeout(() => {
        try { child.kill('SIGKILL') } catch {}
      }, 5000)
      forced.unref?.()
      child.once('exit', () => {
        clearTimeout(forced)
        this.start()
      })
      this.arm()
      return
    }
    this.start()
  }


  latest(now = Date.now()) {
    try {
      const pass = JSON.parse(readFileSync(join(this.options.outDir, 'latest.json'), 'utf8'))
      const at = Number(pass?.at)
      return { pass, error: undefined, ageMs: Number.isFinite(at) ? Math.max(0, now - at) : undefined }
    } catch (error) {
      let childError
      try {
        childError = readFileSync(join(this.options.outDir, 'sampler-error.txt'), 'utf8').trim()
      } catch {}
      return { pass: undefined, error: childError ?? `no pass yet (${String(error?.code ?? error)})`, ageMs: undefined }
    }
  }

  view() {
    const pid = this.child?.pid
    return {
      running: pid !== undefined,
      pid,
      generation: this.generation,
      starts: this.starts,
      lastExit: this.lastExit,
      restarts: [...this.restarts],
      rssBytes: pid === undefined ? undefined : residentBytes(pid),
      stderrTail: this.stderrTail,
      outDir: this.options.outDir,
    }
  }

  stop() {
    this.stopped = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    const child = this.child
    this.child = undefined
    if (child !== undefined) {
      try { child.kill('SIGTERM') } catch {}
    }
    try { rmSync(join(this.options.outDir, 'sampler.pid'), { force: true }) } catch {}
  }
}
