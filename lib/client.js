window.__ModuleLoader__.load({
  id: 'dsh-traffic-statistics',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    const REPORT_ROUTE = '/__trafficstat/report'
    const SETTINGS_ROUTE = '/__trafficstat/settings'

    const CSS = [
      '.ts-panel{display:flex;flex-direction:column;gap:14px;padding:4px 0;font-size:13px;color:var(--dsw-alias-label-primary,#1f2328)}',
      '.ts-panel .ts-hint{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary,#6b7280)}',
      '.ts-panel .ts-mono{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,monospace);font-variant-numeric:tabular-nums}',
      '.ts-panel .ts-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.ts-panel .ts-stack{display:flex;flex-direction:column;gap:12px}',
      '.ts-panel .ts-hero{display:flex;flex-direction:column;gap:6px;padding:16px 18px;border:1px solid var(--dsw-alias-border-l2,#d8dbe0);border-radius:14px;background:var(--dsw-alias-bg-layer-2,#f7f8f9)}',
      '.ts-panel .ts-hero .v{font-size:32px;font-weight:700;line-height:1.1}',
      '.ts-panel .ts-hero .k{font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280);text-transform:uppercase;letter-spacing:.04em}',
      '.ts-panel .ts-hero .s{font-size:12px;color:var(--dsw-alias-label-tertiary,#8a8f98);line-height:1.5}',
      '.ts-panel .ts-section-title{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#6b7280);text-transform:uppercase;letter-spacing:.04em;margin:2px 0 0}',
      '.ts-panel .ts-bar{position:relative;height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-3,#eceef1);overflow:hidden;min-width:60px;flex:1}',
      '.ts-panel .ts-bar > i{position:absolute;inset:0 auto 0 0;display:block;border-radius:999px}',
      '.ts-panel .ts-lane{display:grid;grid-template-columns:72px 1fr 88px 56px;gap:10px;align-items:center}',
      '.ts-panel .ts-lane .name{font-size:12.5px;font-weight:500;display:flex;align-items:center;gap:6px;white-space:nowrap}',
      '.ts-panel .ts-dot{width:8px;height:8px;border-radius:999px;display:inline-block;flex:none}',
      '.ts-panel .ts-lane-block{display:flex;flex-direction:column;gap:2px}',
      '.ts-panel .ts-producers{display:flex;flex-direction:column;margin-left:18px}',
      '.ts-panel .ts-producer{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:1px 0;font-size:12px}',
      '.ts-panel .ts-producer-name{color:var(--dsw-alias-label-secondary,#6b7280);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ts-panel .ts-producer-bytes{color:var(--dsw-alias-label-primary,#1f2328);white-space:nowrap}',
      '.ts-panel button{display:inline-flex;align-items:center;justify-content:center;min-height:30px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2,#d8dbe0);border-radius:999px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2328);font-size:12.5px;font-weight:500;cursor:pointer}',
      '.ts-panel button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#f2f3f5)}',
      '.ts-panel button.primary{background:var(--dsw-alias-button-primary-fill,#1f2328);color:#fff;border-color:transparent;font-weight:600}',
      '.ts-panel button:disabled{opacity:.5;cursor:default}',
      '.ts-panel select,.ts-panel input[type=number],.ts-panel input[type=time]{box-sizing:border-box;padding:5px 8px;min-width:110px;border:1px solid var(--dsw-alias-border-l2,#d8dbe0);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2328);font-size:12.5px}',
      '.ts-panel label.ts-check{display:flex;gap:8px;align-items:center;cursor:pointer}',
      '.ts-panel .ts-ok{color:var(--dsw-alias-state-success-primary,#1a7f37)}',
      '.ts-panel .ts-bad{color:var(--dsw-alias-state-error-primary,#c0392b)}',
      '.ts-panel .ts-cta{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:1px dashed var(--dsw-alias-border-l2,#d8dbe0);border-radius:12px}',
      '.ts-panel .ts-cta .ts-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#6b7280);text-transform:uppercase;letter-spacing:.04em}',
      '.ts-panel.ts-busy{opacity:.6}',
    ].join('\n')

    const LANE_COLORS = { chat: '#1a56b8', tools: '#1a7f37', plugins: '#6b3fa0', other: '#8a8f98' }

    function formatBytes(bytes) {
      var n = Number(bytes) || 0
      var units = ['B', 'KB', 'MB', 'GB', 'TB']
      var value = n
      var unit = 0
      while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
      return (value >= 100 || unit === 0 ? String(Math.round(value)) : value.toFixed(1)) + ' ' + units[unit]
    }

    function pct(share) {
      var value = (Number(share) || 0) * 100
      if (value > 0 && value < 0.1) return '<0.1%'
      return (value >= 10 ? value.toFixed(1) : value.toFixed(2)) + '%'
    }

    function duration(ms) {
      var n = Math.max(0, Number(ms) || 0)
      var s = Math.round(n / 1000)
      var d = Math.floor(s / 86400); s -= d * 86400
      var h = Math.floor(s / 3600); s -= h * 3600
      var m = Math.floor(s / 60); s -= m * 60
      if (d > 0) return d + ' 天 ' + h + ' 小时'
      if (h > 0) return h + ' 小时 ' + m + ' 分'
      if (m > 0) return m + ' 分 ' + s + ' 秒'
      return s + ' 秒'
    }

    async function getJson(url) {
      const response = await fetch(url, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || ('HTTP ' + response.status))
      return body
    }

    async function postJson(url, payload) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || body.ok === false) throw new Error(body.error || ('HTTP ' + response.status))
      return body
    }

    function createOwnedStyle(text) {
      const el = document.createElement('style')
      el.dataset.trafficstat = '1'
      el.textContent = text
      document.head.append(el)
      return el
    }

    function download(name, text, type) {
      const blob = new Blob([text], { type: type })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = name
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(function () { URL.revokeObjectURL(url) }, 2000)
    }

    function csvCell(value) {
      var text = String(value === undefined || value === null ? '' : value)
      return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text
    }

    function Panel() {
      const [report, setReport] = React.useState(null)
      const [settingsState, setSettingsState] = React.useState(null)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [range, setRange] = React.useState('run')
      const [draft, setDraft] = React.useState(null)

      const loadReport = React.useCallback(async function (which) {
        try {
          const nextReport = await getJson(REPORT_ROUTE + '?range=' + encodeURIComponent(which))
          setReport(nextReport)
          setError('')
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      }, [])

      const loadSettings = React.useCallback(async function () {
        try {
          const nextSettings = await getJson(SETTINGS_ROUTE)
          setSettingsState(nextSettings)
          setDraft(nextSettings.settings)
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      }, [])

      React.useEffect(function () { loadSettings() }, [loadSettings])

      React.useEffect(function () {
        loadReport(range)
        var timer = setInterval(function () { loadReport(range) }, 5000)
        return function () { clearInterval(timer) }
      }, [range, loadReport])

      var changeRange = function (next) {
        setRange(next)
      }

      var saveSettings = async function () {
        if (draft === null) return
        setBusy(true); setError(''); setNotice('')
        try {
          const result = await postJson(SETTINGS_ROUTE, draft)
          setSettingsState(function (previous) { return { ...previous, settings: result.settings } })
          setDraft(result.settings)
          setNotice('已保存' + (result.applied && result.applied.length > 0 ? '，已生效：' + result.applied.join('、') : ''))
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
        } finally {
          setBusy(false)
        }
      }

      var patch = function (section, key, value) {
        setDraft(function (previous) {
          if (previous === null) return previous
          if (section === null) { var top = { ...previous }; top[key] = value; return top }
          var next = { ...previous }
          next[section] = { ...previous[section] }; next[section][key] = value
          return next
        })
      }

      const data = report
      const dirty = draft !== null && settingsState !== null && JSON.stringify(draft) !== JSON.stringify(settingsState.settings)

      var exportJson = function () {
        if (data === null) return
        download('traffic-statistics-' + data.range.id + '-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '') + '.json', JSON.stringify(data, null, 2), 'application/json')
      }
      var exportCsv = function () {
        if (data === null) return
        var lines = ['lane,producer,bytes']
        ;(data.lanes.rows || []).forEach(function (row) {
          lines.push([row.label || row.lane, '', row.bytes].map(csvCell).join(','))
          ;((data.lanes.producers || {})[row.lane] || []).forEach(function (p) {
            lines.push(['', p.name, p.bytes].map(csvCell).join(','))
          })
        })
        download('traffic-statistics-' + data.range.id + '-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '') + '.csv', lines.join('\n'), 'text/csv')
      }

      var toolbar = React.createElement('div', { className: 'ts-row' },
        React.createElement('span', { className: 'ts-title', style: { fontSize: '12px', fontWeight: '600', color: 'var(--dsw-alias-label-primary,#1f2328)' } }, '流量统计'),
        React.createElement('select', { value: range, onChange: function (event) { changeRange(event.target.value) }, title: '时间范围（只影响展示，不改变累计）' },
          React.createElement('option', { value: 'run' }, '本次运行'),
          React.createElement('option', { value: 'today' }, '今天'),
          React.createElement('option', { value: 'month' }, '本月'),
          React.createElement('option', { value: 'all' }, '全部')),
        React.createElement('button', { type: 'button', onClick: exportJson, disabled: data === null }, '导出 JSON'),
        React.createElement('button', { type: 'button', onClick: exportCsv, disabled: data === null }, '导出 CSV'))

      var hero = data === null ? null : React.createElement('div', { className: 'ts-hero' },
        React.createElement('span', { className: 'k' }, 'DSH 进程树 · 公网流量'),
        React.createElement('span', { className: 'v ts-mono' }, data.total.formatted),
        React.createElement('span', { className: 's' },
          'TCP ' + formatBytes(Math.max(0, data.total.bytes - data.total.udp)) + ' · UDP 估算 ' + formatBytes(data.total.udp)
          + ' · 局域网（不计入）' + formatBytes(data.total.lanBytes)))

      var statusLine = data === null ? null : React.createElement('div', { className: 'ts-hint' },
        data.range.label
        + ' · ' + (data.sampler.running ? '采样运行中' : '采样已停止')
        + (typeof data.sampler.passAgeMs === 'number' ? ' · 最新样本 ' + duration(data.sampler.passAgeMs) + ' 前' : ''))

      var laneRows = data === null ? [] : (data.lanes.rows || [])
      var maxLane = laneRows.reduce(function (max, row) { return Math.max(max, row.bytes) }, 0)
      var laneBlocks = data === null ? null : laneRows.map(function (row) {
        var color = LANE_COLORS[row.lane] || LANE_COLORS.other
        var prods = (data.lanes.producers || {})[row.lane] || []
        return React.createElement('div', { key: row.lane, className: 'ts-lane-block' },
          React.createElement('div', { className: 'ts-lane', title: row.note || '' },
            React.createElement('span', { className: 'name' },
              React.createElement('span', { className: 'ts-dot', style: { background: color } }),
              row.label || row.lane),
            React.createElement('div', { className: 'ts-bar' },
              React.createElement('i', { style: { width: Math.max(0, Math.round((row.bytes / Math.max(1, maxLane)) * 100)) + '%', background: color } })),
            React.createElement('span', { className: 'ts-mono', style: { textAlign: 'right' } }, formatBytes(row.bytes)),
            React.createElement('span', { className: 'ts-mono', style: { textAlign: 'right', color: 'var(--dsw-alias-label-secondary,#6b7280)' } }, pct(row.share))),
          prods.length === 0 ? null : React.createElement('div', { className: 'ts-producers' },
            prods.map(function (p) {
              return React.createElement('div', { key: p.name, className: 'ts-producer' },
                React.createElement('span', { className: 'ts-producer-name ts-mono', title: p.name }, p.name),
                React.createElement('span', { className: 'ts-producer-bytes ts-mono' }, formatBytes(p.bytes)))
            })))
      })
      var lanesEmpty = data !== null && maxLane === 0

      var settingsBlock = (settingsState === null || draft === null) ? null : React.createElement('div', { className: 'ts-cta' },
        React.createElement('div', { className: 'ts-title' }, '采样'),
        React.createElement('div', { className: 'ts-row' },
          React.createElement('span', { className: 'ts-hint' }, '采样间隔（毫秒）'),
          React.createElement('input', { type: 'number', value: draft.accounting.sampleIntervalMs, min: 1000, max: 600000, step: 1000, style: { width: '120px', minWidth: '120px' }, onChange: function (event) { patch('accounting', 'sampleIntervalMs', Number(event.target.value)) } }),
          React.createElement('span', { className: 'ts-hint' }, '活跃间隔（毫秒）'),
          React.createElement('input', { type: 'number', value: draft.accounting.sampleActiveIntervalMs, min: 250, max: 600000, step: 250, style: { width: '120px', minWidth: '120px' }, onChange: function (event) { patch('accounting', 'sampleActiveIntervalMs', Number(event.target.value)) } })),

        React.createElement('div', { className: 'ts-title' }, '自动重启（采样进程）'),
        React.createElement('div', { className: 'ts-row' },
          React.createElement('label', { className: 'ts-check' },
            React.createElement('input', { type: 'checkbox', checked: draft.autoRestart.enabled, onChange: function (event) { patch('autoRestart', 'enabled', event.target.checked) } }),
            React.createElement('span', null, '开启')),
          React.createElement('span', { className: 'ts-hint' }, '每日'),
          React.createElement('input', { type: 'time', value: draft.autoRestart.dailyRestartAt, onChange: function (event) { patch('autoRestart', 'dailyRestartAt', event.target.value) } }),
          React.createElement('span', { className: 'ts-hint' }, '内存上限（MB）'),
          React.createElement('input', { type: 'number', value: draft.autoRestart.memoryLimitMb, min: 32, max: 65536, style: { width: '100px', minWidth: '100px' }, onChange: function (event) { patch('autoRestart', 'memoryLimitMb', Number(event.target.value)) } })),

        React.createElement('div', { className: 'ts-row' },
          React.createElement('button', { type: 'button', className: 'primary', disabled: !dirty || busy, onClick: saveSettings }, busy ? '保存中…' : '保存'),
          notice !== '' ? React.createElement('span', { className: 'ts-ok' }, notice) : null,
          error !== '' ? React.createElement('span', { className: 'ts-bad' }, error) : null),

        React.createElement('div', { className: 'ts-row' },
          React.createElement('span', { className: 'ts-hint' }, '版本 v' + ((settingsState && settingsState.version) || (data && data.version) || '') + ' · 设置文件 ' + (settingsState.settingsFile || '') + ' · 数据目录 ' + (settingsState.dataDir || ''))))

      return React.createElement('div', { className: 'ts-panel' + (busy ? ' ts-busy' : '') },
        toolbar,
        error !== '' ? React.createElement('div', { className: 'ts-bad' }, error) : null,
        data === null
          ? React.createElement('div', { className: 'ts-hint' }, error === '' ? '读取中…' : '')
          : React.createElement('div', { className: 'ts-stack' },
            hero,
            statusLine,
            React.createElement('div', { className: 'ts-stack', style: { gap: '6px' } },
              React.createElement('div', { className: 'ts-section-title' }, '分流量'),
              laneBlocks,
              lanesEmpty ? React.createElement('div', { className: 'ts-hint' }, '这个范围内还没有公网流量。开始和 DSH 对话、调用工具或插件后，这里会按「聊天 / 工具 / 插件 / 其它」拆分。') : null),
            React.createElement('div', { className: 'ts-section-title' }, '设置'),
            settingsBlock))
    }

    const inject = ['slots']

    function apply(ctx) {
      const styleEl = createOwnedStyle(CSS)
      ctx.effect(function () { return function () { styleEl.remove() } }, 'dsh-traffic-statistics: styles')
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', function () {
        return slots.register(
          { name: 'settings.section', id: 'traffic-statistics', order: 27, label: '流量统计' },
          function () { return React.createElement(Panel) },
        )
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
