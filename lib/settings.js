

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'


const SAMPLE_MIN_MS = 1000
const SAMPLE_MAX_MS = 600_000




export function defaultSettings() {
  return {
    enabled: true,
    accounting: { enabled: true, sampleIntervalMs: 5000, sampleActiveIntervalMs: 1000 },
    autoRestart: { enabled: false, dailyRestartAt: '04:00', memoryLimitMb: 300 },
  }
}


export function dshHome(env = process.env) {
  const configured = env.DSH_HOME
  return typeof configured === 'string' && configured !== '' ? configured : join(homedir(), '.dsh')
}


export function settingsFile(env = process.env) {
  return join(dshHome(env), 'traffic-statistics.json')
}


export function dataDir(env = process.env) {
  return join(dshHome(env), 'plugins-data', 'dsh-traffic-statistics')
}


function bool(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} 必须是 true 或 false`)
  return value
}


function int(value, label, min, max) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isInteger(n)) throw new Error(`${label} 必须是整数`)
  if (n < min || n > max) throw new Error(`${label} 必须在 ${String(min)}–${String(max)} 之间`)
  return n
}


function clockTime(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error('每日重启时间必须是 24 小时制的 HH:MM（例如 04:00）')
  }
  return value
}


export function normalizeSettings(raw) {
  const base = defaultSettings()
  if (raw === undefined || raw === null) return base
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('设置必须是一个对象')
  const input =  (raw)
  const out = base
  if (input.enabled !== undefined) out.enabled = bool(input.enabled, 'enabled')
  const accounting =  (input.accounting ?? {})
  if (typeof accounting !== 'object' || Array.isArray(accounting)) throw new Error('accounting 必须是一个对象')
  if (accounting.enabled !== undefined) out.accounting.enabled = bool(accounting.enabled, 'accounting.enabled')
  if (accounting.sampleIntervalMs !== undefined) out.accounting.sampleIntervalMs = int(accounting.sampleIntervalMs, 'accounting.sampleIntervalMs', SAMPLE_MIN_MS, SAMPLE_MAX_MS)
  if (accounting.sampleActiveIntervalMs !== undefined) out.accounting.sampleActiveIntervalMs = int(accounting.sampleActiveIntervalMs, 'accounting.sampleActiveIntervalMs', 250, SAMPLE_MAX_MS)
  if (out.accounting.sampleActiveIntervalMs > out.accounting.sampleIntervalMs) {
    throw new Error('accounting.sampleActiveIntervalMs 不能大于 accounting.sampleIntervalMs')
  }
  const restart =  (input.autoRestart ?? {})
  if (typeof restart !== 'object' || Array.isArray(restart)) throw new Error('autoRestart 必须是一个对象')
  if (restart.enabled !== undefined) out.autoRestart.enabled = bool(restart.enabled, 'autoRestart.enabled')
  if (restart.dailyRestartAt !== undefined) out.autoRestart.dailyRestartAt = clockTime(restart.dailyRestartAt)
  if (restart.memoryLimitMb !== undefined) out.autoRestart.memoryLimitMb = int(restart.memoryLimitMb, 'autoRestart.memoryLimitMb', 32, 65536)
  return out
}


export function loadSettings(env = process.env) {
  const file = settingsFile(env)
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if ( (error).code === 'ENOENT') return { settings: defaultSettings(), file }
    return { settings: defaultSettings(), file, error: String(error) }
  }
  try {
    return { settings: normalizeSettings(JSON.parse(text)), file }
  } catch (error) {
    return { settings: defaultSettings(), file, error: `设置文件无法解析，已改用默认值：${error.message}` }
  }
}


export function saveSettings(settings, env = process.env) {
  const file = settingsFile(env)
  const temp = `${file}.tmp`
  mkdirSync(dshHome(env), { recursive: true })
  writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, file)
  return file
}

export const limits = { SAMPLE_MIN_MS, SAMPLE_MAX_MS }
