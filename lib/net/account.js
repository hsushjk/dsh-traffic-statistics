

import { readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { LANE_ORDER, LANE_LABELS, LANE_NOTES } from './accounting.js'

export { LANE_ORDER, LANE_LABELS, LANE_NOTES }


const MAX_MINUTES = 1440


export function minuteKey(at) {
  const date = new Date(at)
  date.setUTCSeconds(0, 0)
  return date.toISOString().slice(0, 16)
}


export function dayKey(at) {
  const date = new Date(at)
  const pad = (n) => String(n).padStart(2, '0')
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}


export function monthKey(at) {
  return dayKey(at).slice(0, 7)
}


export class MinuteBuckets {

  constructor(options) {
    this.file = options.file
    this.now = options.now ?? (() => Date.now())
    this.max = options.max ?? MAX_MINUTES

    this.minutes = new Map()
    this.lastFlush = 0
  }

  load() {
    try {
      const snapshot = JSON.parse(readFileSync(this.file, 'utf8'))
      if (Array.isArray(snapshot?.minutes)) {
        for (const row of snapshot.minutes) {
          if (typeof row?.t !== 'number' || typeof row?.k !== 'string') continue
          this.minutes.set(row.k, row)
        }
      }
    } catch {}
    return this
  }


  fold(window) {
    const key = minuteKey(window.at)
    let row = this.minutes.get(key)
    if (row === undefined) {
      row = { k: key, t: Date.parse(`${key}:00Z`), rx: 0, lan: 0, udp: 0, lanes: {}, producers: {} }
      this.minutes.set(key, row)
    }
    row.rx += window.rx
    row.lan += window.lan
    row.udp += window.udp
    for (const [lane, bytes] of Object.entries(window.lanes)) {
      row.lanes[lane] = (row.lanes[lane] ?? 0) + bytes
    }
    for (const [lane, map] of Object.entries(window.producers ?? {})) {
      const target = (row.producers[lane] ??= {})
      for (const [name, bytes] of Object.entries(map)) {
        target[name] = (target[name] ?? 0) + bytes
      }
    }
    if (this.minutes.size > this.max) {
      const keys = [...this.minutes.keys()].sort()
      for (const stale of keys.slice(0, this.minutes.size - this.max)) this.minutes.delete(stale)
    }
  }


  range(from, to) {
    const rows = [...this.minutes.values()]
      .filter(row => (from === undefined || row.t >= from) && (to === undefined || row.t < to))
      .sort((a, b) => a.t - b.t)
    const total = { rx: 0, lan: 0, udp: 0, lanes: {}, producers: {} }
    for (const row of rows) {
      total.rx += row.rx
      total.lan += row.lan
      total.udp += row.udp
      for (const [lane, bytes] of Object.entries(row.lanes)) total.lanes[lane] = (total.lanes[lane] ?? 0) + bytes
      for (const [lane, map] of Object.entries(row.producers ?? {})) {
        const target = (total.producers[lane] ??= {})
        for (const [name, bytes] of Object.entries(map)) target[name] = (target[name] ?? 0) + bytes
      }
    }
    const sorted = [...this.minutes.keys()].sort()
    return {
      ...total,
      minutes: rows.length,
      from: rows.length === 0 ? undefined : rows[0].t,
      to: rows.length === 0 ? undefined : rows[rows.length - 1].t,
      oldest: sorted.length === 0 ? undefined : sorted[0],
      rangeCapped: this.minutes.size >= this.max,
    }
  }

  save(now = this.now()) {
    try {
      mkdirSync(join(this.file, '..'), { recursive: true })
      const pairs = [...this.minutes.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-this.max)
      const body = JSON.stringify({ version: 1, savedAt: now, minutes: pairs.map(([, row]) => row) })
      const temp = `${this.file}.tmp`
      writeFileSync(temp, body, { mode: 0o600 })
      renameSync(temp, this.file)
      this.lastFlush = now
    } catch (error) {
      process.stderr.write(`[traffic-statistics] bucket write failed: ${String(error)}\n`)
    }
  }


  static split(totals) {
    const grand = totals.rx ?? 0
    const rows = []
    for (const lane of LANE_ORDER) {
      const bytes = totals.lanes?.[lane] ?? 0
      rows.push({
        lane,
        label: LANE_LABELS[lane] ?? lane,
        bytes,
        share: grand === 0 ? 0 : bytes / grand,
        note: LANE_NOTES[lane] ?? '',
      })
    }


    let stray = 0
    for (const [lane, bytes] of Object.entries(totals.lanes ?? {})) {
      if (LANE_ORDER.includes(lane)) continue
      stray += bytes
    }
    if (stray > 0) rows.find(r => r.lane === 'other').bytes += stray
    for (const row of rows) row.share = grand === 0 ? 0 : row.bytes / grand
    rows.sort((a, b) => b.bytes - a.bytes)

    const producers = {}
    for (const lane of LANE_ORDER) {
      const map = totals.producers?.[lane] ?? {}
      producers[lane] = Object.entries(map)
        .map(([name, bytes]) => ({ name, bytes }))
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 20)
    }
    return { rows, grand, udp: totals.udp ?? 0, lan: totals.lan ?? 0, producers }
  }
}
