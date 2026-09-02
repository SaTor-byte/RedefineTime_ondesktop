const { app, BrowserWindow, ipcMain, powerMonitor, screen } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { execFile } = require('node:child_process')

const isDev = !app.isPackaged && process.argv.includes('--dev')
const WINDOW_MIN = { width: 320, height: 320 }
const WINDOW_MAX = { width: 620, height: 620 }
let mainWindow
let statePath
let currentState = null
let revealTimer

const LEGACY_QUOTES = new Set([
  '把今天过好，就是很了不起的进度。',
  '慢一点也没关系，正在前进就好。',
  '记得给自己留一点呼吸的空间。',
  '完成一件小事，也值得被记下来。',
  '愿今天的努力，刚好照亮明天。',
  '现在这一刻，也属于你的生活。',
])

function sanitizeQuotePool(value, sourceVersion) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const pool = []
  for (const entry of value) {
    const legacyText = typeof entry === 'string'
    const text = legacyText ? entry.trim() : isObject(entry) && typeof entry.text === 'string' ? entry.text.trim() : ''
    if (!text || text.length > 120 || seen.has(text)) continue
    if (sourceVersion < 8 && legacyText && LEGACY_QUOTES.has(text)) continue
    const createdAt = isObject(entry) && finiteNumber(entry.createdAt, 0) > 0 ? finiteNumber(entry.createdAt, 0) : Date.now()
    const id = isObject(entry) && typeof entry.id === 'string' && entry.id ? entry.id : `${createdAt}-${Math.random().toString(36).slice(2, 8)}`
    seen.add(text)
    pool.push({ id, text, createdAt })
  }
  return pool
}

const defaultState = {
  version: 9,
  settings: {
    initialized: false,
    monthlySalary: 12000,
    startTime: '09:00',
    endTime: '18:00',
    theme: 'minimal',
    moneyAnimation: true,
    quotePool: [],
    autoLaunch: false,
    holidayOverrides: {},
    pageDayOverrides: {},
  },
  totals: { monthKey: '', main: 0, dailyMain: 0, mainByCycle: {}, normalSecondsByCycle: {}, leave: 0, overtime: 0 },
  runtime: {
    leaveRunning: false,
    overtimeRunning: false,
    overtimeMode: 'none',
    workdayStatus: 'working',
    workdayEndCycleKey: '',
    workdayEndAt: 0,
    workdayOvertimeRate: 0,
    overtimeSegmentStartedAt: 0,
    overtimePausedAt: 0,
    preWorkOvertimeRunning: false,
    preWorkOvertimeDeclined: false,
    preWorkOvertimeCycleKey: '',
    preWorkOvertimeStartedAt: 0,
    preWorkOvertimeProcessedAt: 0,
    preWorkOvertimeRate: 0,
    overtimeCycleKey: '',
    dismissedNonworkdayCycle: '',
    decisionCycle: '',
    decision: '',
    cycleKey: '',
    mainCycleKey: '',
    mainProcessedAt: 0,
    leaveProcessedAt: 0,
    overtimeProcessedAt: 0,
    lastRefreshKey: '',
    dailyQuote: '',
    dailyQuoteId: '',
    quoteCycleKey: '',
  },
  window: { x: null, y: null, width: 360, height: 420, adjustable: true }
}

const THEME_IDS = new Set(['charcoal', 'beige', 'warm', 'minimal', 'coffee', 'nature', 'nordic', 'purple', 'cyan', 'starry'])

function cloneDefault() {
  return JSON.parse(JSON.stringify(defaultState))
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function finiteInteger(value, fallback) {
  return Number.isFinite(value) ? Math.round(Number(value)) : fallback
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function validTime(value, fallback) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback
}

function normalizeWindowState(raw, useDefaultSize = false) {
  const source = isObject(raw) ? raw : {}
  const width = useDefaultSize ? defaultState.window.width : clamp(finiteInteger(source.width, defaultState.window.width), WINDOW_MIN.width, WINDOW_MAX.width)
  const height = useDefaultSize ? defaultState.window.height : clamp(finiteInteger(source.height, defaultState.window.height), WINDOW_MIN.height, WINDOW_MAX.height)
  let x = Number.isFinite(source.x) ? Math.round(Number(source.x)) : null
  let y = Number.isFinite(source.y) ? Math.round(Number(source.y)) : null
  let visibleOnDisplay = false

  try {
    if (x !== null && y !== null) {
      visibleOnDisplay = screen.getAllDisplays().some(({ workArea }) => (
        x < workArea.x + workArea.width && x + width > workArea.x &&
        y < workArea.y + workArea.height && y + height > workArea.y
      ))
    }
    if (!visibleOnDisplay) {
      const workArea = screen.getPrimaryDisplay().workArea
      const maxX = Math.max(workArea.x, workArea.x + workArea.width - width - 32)
      const maxY = Math.max(workArea.y, workArea.y + workArea.height - height - 32)
      x = clamp(workArea.x + workArea.width - width - 32, workArea.x, maxX)
      y = clamp(workArea.y + workArea.height - height - 32, workArea.y, maxY)
    }
  } catch {
    if (x === null || y === null) {
      x = null
      y = null
    }
  }

  return {
    x,
    y,
    width,
    height,
    adjustable: typeof source.adjustable === 'boolean' ? source.adjustable : defaultState.window.adjustable,
  }
}

function normalizeState(raw) {
  const source = isObject(raw) ? raw : {}
  const sourceVersion = finiteNumber(source.version, 0)
  const settings = isObject(source.settings) ? source.settings : {}
  const totals = isObject(source.totals) ? source.totals : {}
  const runtime = isObject(source.runtime) ? source.runtime : {}
  const holidayOverrides = isObject(settings.holidayOverrides)
    ? Object.fromEntries(Object.entries(settings.holidayOverrides).filter(([key, value]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && typeof value === 'boolean'))
    : {}
  const pageDayOverrides = isObject(settings.pageDayOverrides)
    ? Object.fromEntries(Object.entries(settings.pageDayOverrides).filter(([key, value]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && typeof value === 'boolean'))
    : {}
  const overtimeMode = ['none', 'workday', 'nonworkday'].includes(runtime.overtimeMode) ? runtime.overtimeMode : 'none'
  const workdayStatus = ['working', 'awaiting-decision', 'sleeping', 'overtime-running', 'overtime-paused'].includes(runtime.workdayStatus) ? runtime.workdayStatus : 'working'
  const decision = ['', 'off', 'overtime'].includes(runtime.decision) ? runtime.decision : ''

  const legacyMain = finiteNumber(totals.main, 0)
  const legacyDailyMain = finiteNumber(totals.dailyMain, 0)
  const normalizedMainByCycle = isObject(totals.mainByCycle)
    ? Object.fromEntries(Object.entries(totals.mainByCycle).filter(([key, value]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(value)).map(([key, value]) => [key, Number(value)]))
    : {}
  if (Object.keys(normalizedMainByCycle).length === 0 && legacyMain > 0 && typeof runtime.cycleKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(runtime.cycleKey)) {
    normalizedMainByCycle[runtime.cycleKey] = legacyDailyMain || legacyMain
  }

  return {
    version: 9,
    settings: {
      initialized: typeof settings.initialized === 'boolean' ? settings.initialized : defaultState.settings.initialized,
      monthlySalary: Math.max(1, finiteNumber(settings.monthlySalary, defaultState.settings.monthlySalary)),
      startTime: validTime(settings.startTime, defaultState.settings.startTime),
      endTime: validTime(settings.endTime, defaultState.settings.endTime),
      theme: THEME_IDS.has(settings.theme) ? settings.theme : defaultState.settings.theme,
      moneyAnimation: typeof settings.moneyAnimation === 'boolean' ? settings.moneyAnimation : defaultState.settings.moneyAnimation,
      quotePool: sanitizeQuotePool(settings.quotePool, sourceVersion),
      autoLaunch: typeof settings.autoLaunch === 'boolean' ? settings.autoLaunch : defaultState.settings.autoLaunch,
      holidayOverrides,
      pageDayOverrides,
    },
    totals: {
      monthKey: typeof totals.monthKey === 'string' ? totals.monthKey : '',
      main: legacyMain,
      dailyMain: legacyDailyMain,
      mainByCycle: normalizedMainByCycle,
      normalSecondsByCycle: isObject(totals.normalSecondsByCycle)
        ? Object.fromEntries(Object.entries(totals.normalSecondsByCycle).filter(([key, value]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(value) && Number(value) >= 0).map(([key, value]) => [key, Number(value)]))
        : {},
      leave: finiteNumber(totals.leave, 0),
      overtime: finiteNumber(totals.overtime, 0),
    },
    runtime: {
      leaveRunning: Boolean(runtime.leaveRunning),
      overtimeRunning: Boolean(runtime.overtimeRunning),
      overtimeMode,
      workdayStatus,
      workdayEndCycleKey: typeof runtime.workdayEndCycleKey === 'string' ? runtime.workdayEndCycleKey : '',
      workdayEndAt: Math.max(0, finiteNumber(runtime.workdayEndAt, 0)),
      workdayOvertimeRate: Math.max(0, finiteNumber(runtime.workdayOvertimeRate, 0)),
      overtimeSegmentStartedAt: Math.max(0, finiteNumber(runtime.overtimeSegmentStartedAt, 0)),
      overtimePausedAt: Math.max(0, finiteNumber(runtime.overtimePausedAt, 0)),
      preWorkOvertimeRunning: Boolean(runtime.preWorkOvertimeRunning),
      preWorkOvertimeDeclined: Boolean(runtime.preWorkOvertimeDeclined),
      preWorkOvertimeCycleKey: typeof runtime.preWorkOvertimeCycleKey === 'string' ? runtime.preWorkOvertimeCycleKey : '',
      preWorkOvertimeStartedAt: Math.max(0, finiteNumber(runtime.preWorkOvertimeStartedAt, 0)),
      preWorkOvertimeProcessedAt: Math.max(0, finiteNumber(runtime.preWorkOvertimeProcessedAt, 0)),
      preWorkOvertimeRate: Math.max(0, finiteNumber(runtime.preWorkOvertimeRate, 0)),
      overtimeCycleKey: typeof runtime.overtimeCycleKey === 'string' ? runtime.overtimeCycleKey : '',
      dismissedNonworkdayCycle: typeof runtime.dismissedNonworkdayCycle === 'string' ? runtime.dismissedNonworkdayCycle : '',
      decisionCycle: typeof runtime.decisionCycle === 'string' ? runtime.decisionCycle : '',
      decision,
      cycleKey: typeof runtime.cycleKey === 'string' ? runtime.cycleKey : '',
      mainCycleKey: typeof runtime.mainCycleKey === 'string' ? runtime.mainCycleKey : '',
      mainProcessedAt: Math.max(0, finiteNumber(runtime.mainProcessedAt, 0)),
      leaveProcessedAt: Math.max(0, finiteNumber(runtime.leaveProcessedAt, 0)),
      overtimeProcessedAt: Math.max(0, finiteNumber(runtime.overtimeProcessedAt, 0)),
      lastRefreshKey: typeof runtime.lastRefreshKey === 'string' ? runtime.lastRefreshKey : '',
      dailyQuote: typeof runtime.dailyQuote === 'string' ? runtime.dailyQuote : '',
      dailyQuoteId: typeof runtime.dailyQuoteId === 'string' ? runtime.dailyQuoteId : '',
      quoteCycleKey: typeof runtime.quoteCycleKey === 'string' ? runtime.quoteCycleKey : '',
    },
    window: normalizeWindowState(source.window, !Number.isFinite(Number(source.version)) || Number(source.version) < 4),
  }
}

function diagnosticLog(label, details = '') {
  const line = `[${new Date().toISOString()}] ${label}${details ? ` ${details}` : ''}\n`
  try {
    const logPath = statePath ? path.join(path.dirname(statePath), 'startup.log') : path.join(app.getPath('userData'), 'startup.log')
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    fs.appendFileSync(logPath, line, 'utf8')
  } catch {
    process.stderr.write(line)
  }
}

function readState() {
  if (!statePath) return cloneDefault()
  try {
    return normalizeState(JSON.parse(fs.readFileSync(statePath, 'utf8')))
  } catch (error) {
    diagnosticLog('state-read-failed', error instanceof Error ? error.message : String(error))
    return normalizeState(defaultState)
  }
}

function writeState(nextState) {
  currentState = normalizeState(nextState)
  if (!statePath) return currentState
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    const tmpPath = `${statePath}.tmp`
    fs.writeFileSync(tmpPath, JSON.stringify(currentState, null, 2), 'utf8')
    fs.renameSync(tmpPath, statePath)
  } catch (error) {
    diagnosticLog('state-write-failed', error instanceof Error ? error.message : String(error))
  }
  return currentState
}

function sendToBottom() {
  if (!mainWindow || process.platform !== 'win32' || mainWindow.isDestroyed()) return
  try {
    const handleBuffer = mainWindow.getNativeWindowHandle()
    const handle = handleBuffer.length >= 8 ? handleBuffer.readBigUInt64LE(0).toString() : handleBuffer.readUInt32LE(0).toString()
    const script = `$h=[IntPtr]${handle};Add-Type @'\nusing System;using System.Runtime.InteropServices;public static class W{[DllImport(\"user32.dll\")]public static extern bool SetWindowPos(IntPtr h,IntPtr i,int x,int y,int cx,int cy,uint f);}\n'@;[W]::SetWindowPos($h,[IntPtr]1,0,0,0,0,0x0003 -bor 0x0010 -bor 0x0040)`
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], { windowsHide: true }, (error, _stdout, stderr) => {
      if (error) diagnosticLog('set-window-bottom-failed', `${error.message}${stderr ? ` ${stderr.trim()}` : ''}`)
    })
  } catch (error) {
    diagnosticLog('set-window-bottom-exception', error instanceof Error ? error.message : String(error))
  }
}

function applyWindowState() {
  if (!mainWindow || mainWindow.isDestroyed() || !currentState) return
  const safeWindow = normalizeWindowState(currentState.window)
  currentState.window = safeWindow
  mainWindow.setSize(safeWindow.width, safeWindow.height, false)
  if (Number.isInteger(safeWindow.x) && Number.isInteger(safeWindow.y)) mainWindow.setPosition(safeWindow.x, safeWindow.y, false)
  mainWindow.setResizable(safeWindow.adjustable)
  mainWindow.setMovable(safeWindow.adjustable)
  if (!safeWindow.adjustable) sendToBottom()
}

function revealWindow(reason) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    try {
      applyWindowState()
    } catch (error) {
      diagnosticLog('window-state-apply-failed', `${reason} ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!mainWindow.isVisible()) mainWindow.showInactive()
    if (!mainWindow.isVisible()) mainWindow.show()
    if (!mainWindow.isVisible()) diagnosticLog('window-still-hidden', reason)
  } catch (error) {
    diagnosticLog('window-reveal-failed', `${reason} ${error instanceof Error ? error.message : String(error)}`)
    try { mainWindow.show() } catch (fallbackError) { diagnosticLog('window-reveal-fallback-failed', fallbackError instanceof Error ? fallbackError.message : String(fallbackError)) }
  }
}

function registerIpcHandlers() {
  ipcMain.handle('state:get', () => currentState)
  ipcMain.handle('state:save', (_event, nextState) => writeState(nextState))
  ipcMain.handle('window:set-adjustable', (_event, adjustable) => {
    if (!mainWindow || !currentState) return
    currentState.window.adjustable = Boolean(adjustable)
    writeState(currentState)
    try {
      mainWindow.setResizable(currentState.window.adjustable)
      mainWindow.setMovable(currentState.window.adjustable)
      if (!currentState.window.adjustable) {
        mainWindow.blur()
        sendToBottom()
      }
    } catch (error) {
      diagnosticLog('window-adjustable-failed', error instanceof Error ? error.message : String(error))
    }
  })
  ipcMain.handle('window:close', () => app.quit())
  ipcMain.handle('app:set-auto-launch', (_event, enabled) => {
    const openAtLogin = Boolean(enabled)
    app.setLoginItemSettings({ openAtLogin })
    if (currentState) {
      currentState.settings.autoLaunch = openAtLogin
      writeState(currentState)
    }
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: defaultState.window.width,
    height: defaultState.window.height,
    minWidth: WINDOW_MIN.width,
    minHeight: WINDOW_MIN.height,
    maxWidth: WINDOW_MAX.width,
    maxHeight: WINDOW_MAX.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    movable: true,
    show: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  const loadPromise = isDev
    ? mainWindow.loadURL('http://127.0.0.1:5173')
    : mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  loadPromise.catch((error) => {
    diagnosticLog('page-load-failed', error instanceof Error ? error.message : String(error))
    revealWindow('load-error')
  })

  mainWindow.webContents.on('did-finish-load', () => {
    diagnosticLog('page-finished-load', isDev ? 'dev' : 'production')
    revealWindow('did-finish-load')
  })
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    diagnosticLog('did-fail-load', `${errorCode} ${errorDescription} ${validatedURL} main=${isMainFrame}`)
    if (isMainFrame) revealWindow('did-fail-load')
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    diagnosticLog('render-process-gone', JSON.stringify(details))
    revealWindow('render-process-gone')
  })
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) diagnosticLog('renderer-console', `${message} (${sourceId}:${line})`)
  })
  mainWindow.once('ready-to-show', () => revealWindow('ready-to-show'))
  revealTimer = setTimeout(() => revealWindow('startup-timeout'), 2000)

  const saveWindow = () => {
    if (!currentState || !mainWindow || mainWindow.isDestroyed()) return
    const [x, y] = mainWindow.getPosition()
    const [width, height] = mainWindow.getSize()
    currentState.window = normalizeWindowState({ ...currentState.window, x, y, width, height })
    writeState(currentState)
  }
  mainWindow.on('move', saveWindow)
  mainWindow.on('resize', saveWindow)
  mainWindow.on('blur', () => {
    if (currentState && !currentState.window.adjustable) sendToBottom()
  })
  mainWindow.on('closed', () => {
    if (revealTimer) clearTimeout(revealTimer)
    revealTimer = undefined
    mainWindow = null
  })
}

app.whenReady().then(() => {
  statePath = path.join(app.getPath('userData'), 'desk-earnings-note.json')
  currentState = readState()
  app.setLoginItemSettings({ openAtLogin: Boolean(currentState.settings.autoLaunch) })
  registerIpcHandlers()
  createWindow()

  powerMonitor.on('suspend', () => mainWindow?.webContents.send('power-state', 'suspend'))
  powerMonitor.on('resume', () => mainWindow?.webContents.send('power-state', 'resume'))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else revealWindow('activate')
  })
}).catch((error) => diagnosticLog('app-ready-failed', error instanceof Error ? error.message : String(error)))

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
