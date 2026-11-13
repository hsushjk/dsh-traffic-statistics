

import { readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'

import { MinuteBuckets, dayKey, monthKey, LANE_LABELS, LANE_NOTES } from './net/account.js'
import { SamplerSupervisor } from './proc/supervisor.js'
import { dataDir, loadSettings, normalizeSettings, saveSettings } from './settings.js'

export const name = 'traffic-statistics'


export const VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version

export const inject = ['webServer', 'connection']

export const REPORT_ROUTE = '/__trafficstat/report'
export const SETTINGS_ROUTE = '/__trafficstat/settings'


const MAX_BODY_BYTES = 16 * 1024


export function formatBytes(bytes) {
  const n = Number(bytes) || 0
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = n
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 100 || unit === 0 ? String(Math.round(value)) : value.toFixed(1)} ${units[unit]}`
}


function sendJson(res, status, body) {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  res.end(`${JSON.stringify(body)}\n`)
}


function sendText(res, status, detail) {
  res.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' })
  res.end(`${name}: ${detail}\n`)
}


export function guard(ctx, req) {
  const rejection = ctx.connection.requestRejection(req)
  if (rejection !== undefined && rejection !== 0) return rejection === 401 ? 401 : 403
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    const host = req.headers.host
    try {
      if (new URL(origin).host !== host) return 403
    } catch {
      return 403
    }
  }
  return undefined
}


function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`request body exceeds ${String(MAX_BODY_BYTES)} bytes`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') {
        resolve({})
        return
      }
      try {
        const value = JSON.parse(text)
        if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('body must be a JSON object')
        resolve(value)
      } catch (error) {
        reject(new Error(`body is not a JSON object (${String(error)})`))
      }
    })
    req.on('error', reject)
  })
}


export function rangeWindow(range, now) {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  if (range === 'today') return { from: start.getTime(), to: undefined, label: `今天（${dayKey(now)}）` }
  if (range === 'month') {
    const monthStart = new Date(start.getTime())
    monthStart.setDate(1)
    return { from: monthStart.getTime(), to: undefined, label: `本月（${monthKey(now)}）` }
  }
  if (range === 'run') return { from: undefined, to: undefined, label: '本次运行起（受 24 小时分钟桶限制）' }
  return { from: undefined, to: undefined, label: '全部（受 24 小时分钟桶限制）' }
}


export function apply(ctx, rowConfig) {
  const log = (message) => console.log(`${name}: ${message}`)
  const env = process.env
  const dir = dataDir(env)


  const loaded = loadSettings(env)
  let settings
  if (loaded.error !== undefined) {
    log(loaded.error)
    settings = loaded.settings
  } else {
    try {
      settings = normalizeSettings({ ...rowConfig, ...loaded.settings })
    } catch (error) {
      log(`bundle config ignored: ${String(error)}`)
      settings = loaded.settings
    }
  }

  const buckets = new MinuteBuckets({ file: join(dir, 'minutes.json') }).load()


  let supervisor

  let lastFoldedAt = 0
  let lastFlush = 0



  const startSamplerHost = () => {
    supervisor = new SamplerSupervisor({
      rootPid: process.pid,
      outDir: join(dir, 'sampler'),
      intervalMs: settings.accounting.sampleIntervalMs,
      activeIntervalMs: settings.accounting.sampleActiveIntervalMs,
      autoRestart: settings.autoRestart,
      log,
    })
    supervisor.start()
  }




  const fold = (now) => {
    const latest = supervisor?.latest(now)
    const pass = latest?.pass
    if (pass === undefined) return
    const at = Number(pass.at)
    if (!Number.isFinite(at) || at <= lastFoldedAt) return
    lastFoldedAt = at
    const window = pass.window ?? {}
    buckets.fold({
      at,

      rx: Math.max(0, window.totalBytes ?? 0),
      lan: Math.max(0, window.lanBytes ?? 0),
      udp: Math.max(0, window.udpEstimate ?? 0),
      lanes: pass.lanes ?? {},
      producers: pass.producers ?? {},
    })
    if (now - lastFlush > 60_000) {
      buckets.save(now)
      lastFlush = now
    }
  }

  const foldTimer = setInterval(() => {
    try { fold(Date.now()) } catch (error) { log(`fold failed: ${String(error)}`) }
  }, 2000)
  foldTimer.unref?.()




  const report = (range) => {
    const now = Date.now()
    fold(now)
    const latest = supervisor?.latest(now)
    const pass = latest?.pass
    const window = rangeWindow(range, now)
    const totals = buckets.range(window.from, window.to)
    const split = MinuteBuckets.split(totals)
    const current = pass?.window ?? {}

    return {
      generatedAt: now,
      hostname: hostname(),
      pid: process.pid,
      version: VERSION,
      range: { id: range, label: window.label, capped: totals.rangeCapped === true, minutes: totals.minutes, from: totals.from, to: totals.to },
      total: {
        bytes: split.grand,
        udp: totals.udp,
        lanBytes: totals.lan,
        formatted: formatBytes(split.grand),
        source: 'DSH 进程树公网流量',
      },
      lanes: {
        rows: split.rows,
        grand: split.grand,
        udp: split.udp,
        lan: split.lan,
        producers: split.producers,
      },
      sampler: {
        ...(supervisor?.view() ?? { running: false }),
        passAt: pass?.at,
        passAgeMs: latest?.ageMs,
        passError: latest?.error,
        pidSource: pass?.pidSource,
        pids: pass?.pids?.length ?? 0,
        intervalMs: pass?.periodMs,
        durationMs: pass?.durationMs,
        sources: pass?.sources,
        current: {
          ifaceBytes: current.ifaceBytes ?? 0,
          publicBytes: current.publicBytes ?? 0,
          udpEstimate: current.udpEstimate ?? 0,
          coverage: current.coverage ?? null,
        },
      },
      settings,
    }
  }



  const reportHandler = async (req, res) => {
    const refusal = guard(ctx, req)
    if (refusal !== undefined) {
      sendText(res, refusal, 'refused by the connection trust fence')
      return
    }
    if (req.method !== 'GET') {
      sendText(res, 405, `only GET is supported (got ${String(req.method)})`)
      return
    }
    const url = new URL(req.url ?? '/', `http://${String(req.headers.host ?? 'localhost')}`)
    const range = url.searchParams.get('range') ?? 'run'
    try {
      sendJson(res, 200, report(range))
    } catch (error) {
      log(`report failed: ${String(error)}`)
      sendText(res, 500, `report failed: ${String(error)}`)
    }
  }

  const settingsHandler = async (req, res) => {
    const refusal = guard(ctx, req)
    if (refusal !== undefined) {
      sendText(res, refusal, 'refused by the connection trust fence')
      return
    }
    if (req.method === 'GET') {
      sendJson(res, 200, {
        settings,
        restart: supervisor?.view() ?? { running: false },
        dataDir: dir,
        settingsFile: loaded.file,
        version: VERSION,
        limits: { sampleMinMs: 1000, sampleMaxMs: 600000, memoryMinMb: 32, memoryMaxMb: 65536 },
      })
      return
    }
    if (req.method !== 'POST') {
      sendText(res, 405, `only GET and POST are supported (got ${String(req.method)})`)
      return
    }
    let body
    try {
      body = await readJsonBody(req)
    } catch (error) {
      sendJson(res, 400, { ok: false, error: String(error) })
      return
    }
    let next
    try {
      next = normalizeSettings({ ...settings, ...body, accounting: { ...settings.accounting, ...(body.accounting ?? {}) }, autoRestart: { ...settings.autoRestart, ...(body.autoRestart ?? {}) } })
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message, settings })
      return
    }
    const before = settings
    settings = next
    let file
    try {
      file = saveSettings(next, env)
    } catch (error) {
      sendJson(res, 500, { ok: false, error: `设置已生效，但写入 ${loaded.file} 失败：${String(error)}`, settings })
      return
    }
    const changed = []
    if (before.accounting.sampleIntervalMs !== next.accounting.sampleIntervalMs || before.accounting.sampleActiveIntervalMs !== next.accounting.sampleActiveIntervalMs) {
      supervisor?.stop()
      startSamplerHost()
      changed.push('accounting')
    }
    log(`settings saved to ${file}${changed.length > 0 ? ` (applied: ${changed.join(', ')})` : ''}`)
    sendJson(res, 200, { ok: true, settings: next, applied: changed })
  }

  ctx.effect(() => {
    const disposeReport = ctx.webServer.register({ kind: 'exact', path: REPORT_ROUTE, handler: reportHandler })
    const disposeSettings = ctx.webServer.register({ kind: 'exact', path: SETTINGS_ROUTE, handler: settingsHandler })
    return () => {
      disposeReport()
      disposeSettings()
    }
  }, `${name}: GET ${REPORT_ROUTE} and ${SETTINGS_ROUTE}`)



  startSamplerHost()

  ctx.effect(() => () => {
    clearInterval(foldTimer)
    supervisor?.stop()
    try { fold(Date.now()) } catch {}
    buckets.save()
  }, `${name}: observers`)
}
