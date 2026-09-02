import { useCallback, useEffect, useRef, useState } from 'react'
import {
  activeShift,
  advanceState,
  cycleDate,
  formatDateKey,
  formatMoney,
  formatShortDate,
  isWorkday,
  addDays,
  coverageThrough,
  getShiftForCycle,
  monthKeyFromDate,
  monthToDateThroughYesterday,
  pendingEndCycle,
  rateForCycle,
  recomputeNormalTotals,
  THEMES,
} from './core'
import {
  ArrowDownRight,
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  Lock,
  Minus,
  Move,
  Palette,
  Power,
  RefreshCw,
  Settings,
  Sparkles,
  TimerOff,
  Pencil,
  Plus,
  Save,
  Trash2,
  Zap,
  ZapOff,
  X,
} from 'lucide-react'

const LEGACY_QUOTES = new Set([
  '把今天过好，就是很了不起的进度。',
  '慢一点也没关系，正在前进就好。',
  '记得给自己留一点呼吸的空间。',
  '完成一件小事，也值得被记下来。',
  '愿今天的努力，刚好照亮明天。',
  '现在这一刻，也属于你的生活。',
])

const SLEEP_MESSAGES = [
  '今天真是辛苦我自己了呢',
  '回家要好好睡觉',
  '注意身体，但也要好好享受下班的时间',
]

const EMPTY_STATE: PersistedState = {
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

const moneyClass = (value: number) => value < 0 ? 'negative' : value > 0 ? 'positive' : 'neutral'
const themeIds = new Set<ThemeId>(Object.keys(THEMES) as ThemeId[])
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finiteOr(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function createQuoteRecord(text: string, createdAt = Date.now()): QuoteRecord {
  return { id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`, text, createdAt }
}

function sanitizeQuotePool(value: unknown, sourceVersion: number) {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const pool: QuoteRecord[] = []
  for (const entry of value) {
    const isLegacyText = typeof entry === 'string'
    const text = isLegacyText ? entry.trim() : isRecord(entry) && typeof entry.text === 'string' ? entry.text.trim() : ''
    if (!text || text.length > 120 || seen.has(text)) continue
    if (sourceVersion < 8 && isLegacyText && LEGACY_QUOTES.has(text)) continue
    const createdAt = isRecord(entry) && typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now()
    const id = isRecord(entry) && typeof entry.id === 'string' && entry.id ? entry.id : createQuoteRecord(text, createdAt).id
    seen.add(text)
    pool.push({ id, text, createdAt })
  }
  return pool
}

function sanitizeState(raw: Partial<PersistedState> | null | undefined): PersistedState {
  const source = isRecord(raw) ? raw : {}
  const sourceSettings = (isRecord(source.settings) ? source.settings : {}) as Partial<AppSettings> & Record<string, unknown>
  const sourceTotals = (isRecord(source.totals) ? source.totals : {}) as Partial<Totals> & Record<string, unknown>
  const sourceRuntime = (isRecord(source.runtime) ? source.runtime : {}) as Partial<RuntimeState> & Record<string, unknown>
  const sourceWindow = (isRecord(source.window) ? source.window : {}) as Partial<WindowState> & Record<string, unknown>
  const sourceVersion = typeof source.version === 'number' ? source.version : 0
  const overrides: Record<string, boolean> = {}
  const pageDayOverrides: Record<string, boolean> = {}
  if (isRecord(sourceSettings.holidayOverrides)) {
    for (const [key, value] of Object.entries(sourceSettings.holidayOverrides)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(key) && typeof value === 'boolean') overrides[key] = value
    }
  }
  if (isRecord(sourceSettings.pageDayOverrides)) {
    for (const [key, value] of Object.entries(sourceSettings.pageDayOverrides)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(key) && typeof value === 'boolean') pageDayOverrides[key] = value
    }
  }
  const mainByCycle: Record<string, number> = {}
  if (isRecord(sourceTotals.mainByCycle)) {
    for (const [key, value] of Object.entries(sourceTotals.mainByCycle)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(key) && typeof value === 'number' && Number.isFinite(value)) mainByCycle[key] = value
    }
  }
  const normalSecondsByCycle: Record<string, number> = {}
  if (isRecord(sourceTotals.normalSecondsByCycle)) {
    for (const [key, value] of Object.entries(sourceTotals.normalSecondsByCycle)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(key) && typeof value === 'number' && Number.isFinite(value) && value >= 0) normalSecondsByCycle[key] = value
    }
  }
  const legacyMain = finiteOr(sourceTotals.main, 0)
  const legacyDailyMain = finiteOr(sourceTotals.dailyMain, 0)
  if (Object.keys(mainByCycle).length === 0 && legacyMain > 0 && typeof sourceRuntime.cycleKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sourceRuntime.cycleKey)) {
    mainByCycle[sourceRuntime.cycleKey] = legacyDailyMain || legacyMain
  }
  const overtimeMode = sourceRuntime.overtimeMode === 'workday' || sourceRuntime.overtimeMode === 'nonworkday' ? sourceRuntime.overtimeMode : 'none'
  const workdayStatus = sourceRuntime.workdayStatus === 'awaiting-decision' || sourceRuntime.workdayStatus === 'sleeping' || sourceRuntime.workdayStatus === 'overtime-running' || sourceRuntime.workdayStatus === 'overtime-paused' ? sourceRuntime.workdayStatus : 'working'
  const decision = sourceRuntime.decision === 'off' || sourceRuntime.decision === 'overtime' ? sourceRuntime.decision : ''
  const rawDailyQuote = typeof sourceRuntime.dailyQuote === 'string' ? sourceRuntime.dailyQuote : ''
  const quotePool = sanitizeQuotePool(sourceSettings.quotePool, sourceVersion)
  const savedQuoteId = typeof sourceRuntime.dailyQuoteId === 'string' ? sourceRuntime.dailyQuoteId : ''
  const matchedQuote = quotePool.find((quote) => quote.id === savedQuoteId) || quotePool.find((quote) => quote.text === rawDailyQuote)
  const dailyQuote = matchedQuote?.text || ''
  const dailyQuoteId = matchedQuote?.id || ''
  return {
    version: 9,
    settings: {
      initialized: typeof sourceSettings.initialized === 'boolean' ? sourceSettings.initialized : EMPTY_STATE.settings.initialized,
      monthlySalary: Math.max(1, finiteOr(sourceSettings.monthlySalary, EMPTY_STATE.settings.monthlySalary)),
      startTime: typeof sourceSettings.startTime === 'string' && timePattern.test(sourceSettings.startTime) ? sourceSettings.startTime : EMPTY_STATE.settings.startTime,
      endTime: typeof sourceSettings.endTime === 'string' && timePattern.test(sourceSettings.endTime) ? sourceSettings.endTime : EMPTY_STATE.settings.endTime,
      theme: typeof sourceSettings.theme === 'string' && themeIds.has(sourceSettings.theme as ThemeId) ? sourceSettings.theme as ThemeId : EMPTY_STATE.settings.theme,
      moneyAnimation: typeof sourceSettings.moneyAnimation === 'boolean' ? sourceSettings.moneyAnimation : EMPTY_STATE.settings.moneyAnimation,
      quotePool,
      autoLaunch: typeof sourceSettings.autoLaunch === 'boolean' ? sourceSettings.autoLaunch : EMPTY_STATE.settings.autoLaunch,
      holidayOverrides: overrides,
      pageDayOverrides,
    },
    totals: {
      monthKey: typeof sourceTotals.monthKey === 'string' ? sourceTotals.monthKey : '',
      main: legacyMain,
      dailyMain: legacyDailyMain || (typeof sourceRuntime.cycleKey === 'string' ? mainByCycle[sourceRuntime.cycleKey] || 0 : 0),
      mainByCycle,
      normalSecondsByCycle,
      leave: finiteOr(sourceTotals.leave, 0),
      overtime: finiteOr(sourceTotals.overtime, 0),
    },
    runtime: {
      leaveRunning: Boolean(sourceRuntime.leaveRunning),
      overtimeRunning: Boolean(sourceRuntime.overtimeRunning),
      overtimeMode,
      workdayStatus,
      workdayEndCycleKey: typeof sourceRuntime.workdayEndCycleKey === 'string' ? sourceRuntime.workdayEndCycleKey : '',
      workdayEndAt: Math.max(0, finiteOr(sourceRuntime.workdayEndAt, 0)),
      workdayOvertimeRate: Math.max(0, finiteOr(sourceRuntime.workdayOvertimeRate, 0)),
      overtimeSegmentStartedAt: Math.max(0, finiteOr(sourceRuntime.overtimeSegmentStartedAt, 0)),
      overtimePausedAt: Math.max(0, finiteOr(sourceRuntime.overtimePausedAt, 0)),
      preWorkOvertimeRunning: Boolean(sourceRuntime.preWorkOvertimeRunning),
      preWorkOvertimeDeclined: Boolean(sourceRuntime.preWorkOvertimeDeclined),
      preWorkOvertimeCycleKey: typeof sourceRuntime.preWorkOvertimeCycleKey === 'string' ? sourceRuntime.preWorkOvertimeCycleKey : '',
      preWorkOvertimeStartedAt: Math.max(0, finiteOr(sourceRuntime.preWorkOvertimeStartedAt, 0)),
      preWorkOvertimeProcessedAt: Math.max(0, finiteOr(sourceRuntime.preWorkOvertimeProcessedAt, 0)),
      preWorkOvertimeRate: Math.max(0, finiteOr(sourceRuntime.preWorkOvertimeRate, 0)),
      overtimeCycleKey: typeof sourceRuntime.overtimeCycleKey === 'string' ? sourceRuntime.overtimeCycleKey : '',
      dismissedNonworkdayCycle: typeof sourceRuntime.dismissedNonworkdayCycle === 'string' ? sourceRuntime.dismissedNonworkdayCycle : '',
      decisionCycle: typeof sourceRuntime.decisionCycle === 'string' ? sourceRuntime.decisionCycle : '',
      decision,
      cycleKey: typeof sourceRuntime.cycleKey === 'string' ? sourceRuntime.cycleKey : '',
      mainCycleKey: typeof sourceRuntime.mainCycleKey === 'string' ? sourceRuntime.mainCycleKey : '',
      mainProcessedAt: Math.max(0, finiteOr(sourceRuntime.mainProcessedAt, 0)),
      leaveProcessedAt: Math.max(0, finiteOr(sourceRuntime.leaveProcessedAt, 0)),
      overtimeProcessedAt: Math.max(0, finiteOr(sourceRuntime.overtimeProcessedAt, 0)),
      lastRefreshKey: typeof sourceRuntime.lastRefreshKey === 'string' ? sourceRuntime.lastRefreshKey : '',
      dailyQuote,
      dailyQuoteId,
      quoteCycleKey: typeof sourceRuntime.quoteCycleKey === 'string' ? sourceRuntime.quoteCycleKey : '',
    },
    window: {
      x: Number.isFinite(sourceWindow.x) ? Math.round(Number(sourceWindow.x)) : null,
      y: Number.isFinite(sourceWindow.y) ? Math.round(Number(sourceWindow.y)) : null,
      width: !Number.isFinite(Number(source.version)) || Number(source.version) < 4 ? EMPTY_STATE.window.width : Math.min(620, Math.max(320, Math.round(finiteOr(sourceWindow.width, EMPTY_STATE.window.width)))),
      height: !Number.isFinite(Number(source.version)) || Number(source.version) < 4 ? EMPTY_STATE.window.height : Math.min(620, Math.max(320, Math.round(finiteOr(sourceWindow.height, EMPTY_STATE.window.height)))), 
      adjustable: typeof sourceWindow.adjustable === 'boolean' ? sourceWindow.adjustable : EMPTY_STATE.window.adjustable,
    },
  }
}

function pickQuote(pool: QuoteRecord[], seed: string, avoidId = '') {
  if (pool.length === 0) return undefined
  const hash = [...seed].reduce((total, character) => total + character.charCodeAt(0), 0)
  let index = hash % pool.length
  if (pool.length > 1 && pool[index].id === avoidId) index = (index + 1) % pool.length
  return pool[index]
}

function formatQuoteCreatedAt(createdAt: number) {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(createdAt)).replace(/\//g, '-')
}

function formatQuoteDate(createdAt: number) {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(createdAt)).replace(/\//g, '-')
}

function themeStyle(theme: typeof THEMES[ThemeId]) {
  const background = theme.backgroundImage
    ? `url("${theme.backgroundImage}")`
    : theme.mode === 'solid'
      ? theme.colors[0]
      : theme.background || `linear-gradient(132deg, ${theme.colors.join(', ')})`
  return { '--tone-a': theme.colors[0], '--tone-b': theme.colors[1] || theme.colors[0], '--tone-c': theme.colors[theme.colors.length - 1], '--ink': theme.ink, '--muted': theme.muted, '--accent': theme.accent, '--theme-background': background } as React.CSSProperties
}

function App() {
  const [state, setState] = useState<PersistedState>(EMPTY_STATE)
  const [now, setNow] = useState(() => new Date())
  const [ready, setReady] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(EMPTY_STATE.settings)
  const [showEndPrompt, setShowEndPrompt] = useState(false)
  const [page, setPage] = useState<'launch' | 'dashboard' | 'workday-sleep' | 'rest-day-home' | 'rest-day-overtime' | 'pre-work-prompt' | 'pre-work-overtime'>('launch')
  const [wasSuspended, setWasSuspended] = useState(false)
  const stateRef = useRef(state)
  const lastTickRef = useRef(0)

  const persist = useCallback(async (next: PersistedState) => {
    const safe = sanitizeState(next)
    stateRef.current = safe
    setState(safe)
    try {
      await window.note.saveState(safe)
    } catch {
      // Keep the in-memory dashboard usable when the local file is unavailable.
    }
  }, [])

  const reconcile = useCallback(async (timestamp = Date.now(), boot = false) => {
    const result = advanceState(sanitizeState(stateRef.current), timestamp, boot)
    const safe = sanitizeState(result.state)
    stateRef.current = safe
    setState(safe)
    if (result.didChange) {
      try {
        await window.note.saveState(safe)
      } catch {
        // Rendering does not depend on a successful persistence round-trip.
      }
    }
    setNow(new Date(timestamp))
    return safe
  }, [])

  useEffect(() => {
    let mounted = true
    let timer: number | undefined
    let removePower = () => {}
    Promise.resolve().then(() => window.note.loadState()).then(async (loaded) => {
      if (!mounted) return
      const safe = sanitizeState(loaded)
      stateRef.current = safe
      setState(safe)
      setSettingsDraft(safe.settings)
      await reconcile(Date.now(), true)
      if (!mounted) return
      setReady(true)
      if (!safe.settings.initialized) setShowSettings(true)
      timer = window.setInterval(() => {
        if (Date.now() - lastTickRef.current < 700) return
        lastTickRef.current = Date.now()
        void reconcile()
      }, 500)
      removePower = window.note.onPowerState((powerState) => {
        if (powerState === 'suspend') setWasSuspended(true)
        else if (powerState === 'resume') {
          setWasSuspended(false)
          void reconcile(Date.now(), true)
        }
      })
    }).catch(() => {
      if (!mounted) return
      const safe = sanitizeState(EMPTY_STATE)
      stateRef.current = safe
      setState(safe)
      setSettingsDraft(safe.settings)
      setReady(true)
      setShowSettings(true)
    })
    return () => {
      mounted = false
      if (timer) window.clearInterval(timer)
      removePower()
    }
  }, [reconcile])

  const theme = THEMES[state.settings.theme] || THEMES.minimal
  const currentCycle = cycleDate(now)
  const active = activeShift(now, state.settings)
  const incomeWorkday = isWorkday(currentCycle, state.settings.holidayOverrides)
  const cycleKey = formatDateKey(currentCycle)
  const currentShift = getShiftForCycle(currentCycle, state.settings)
  const pageWorkday = typeof state.settings.pageDayOverrides[cycleKey] === 'boolean' ? state.settings.pageDayOverrides[cycleKey] : incomeWorkday
  const cycleBoundary = new Date(currentCycle)
  cycleBoundary.setHours(6, 0, 0, 0)
  const preWorkWindow = incomeWorkday && now.getTime() >= cycleBoundary.getTime() && now.getTime() < currentShift.start.getTime()
  const currentQuoteRecord = state.settings.quotePool.find((quote) => quote.id === state.runtime.dailyQuoteId)
  const quoteDate = currentQuoteRecord ? formatQuoteDate(currentQuoteRecord.createdAt) : cycleKey
  const currentMonthKey = monthKeyFromDate(currentCycle)
  const overtimeActive = state.runtime.overtimeRunning
  const leaveActive = state.runtime.leaveRunning
  const endedShift = pendingEndCycle(now, state.settings)
  const endCycle = state.runtime.workdayEndCycleKey ? new Date(`${state.runtime.workdayEndCycleKey}T12:00:00`) : endedShift?.cycle
  const endCycleKey = endCycle ? formatDateKey(endCycle) : ''
  const isWorkdaySession = Boolean(endCycle && isWorkday(endCycle, state.settings.holidayOverrides))
  const pendingEnd = state.runtime.workdayStatus === 'awaiting-decision' && isWorkdaySession
  const monthThroughYesterday = monthToDateThroughYesterday(state.totals, cycleKey, currentMonthKey)

  useEffect(() => {
    if (!ready || !state.settings.initialized) return
    if (state.runtime.quoteCycleKey !== cycleKey) {
      const next = structuredClone(stateRef.current)
      const quote = pickQuote(next.settings.quotePool, cycleKey)
      next.runtime.dailyQuote = quote?.text || ''
      next.runtime.dailyQuoteId = quote?.id || ''
      next.runtime.quoteCycleKey = cycleKey
      void persist(next)
    }
  }, [cycleKey, persist, ready, state.runtime.quoteCycleKey, state.settings.initialized])

  useEffect(() => {
    if (!ready || !state.settings.initialized) return
    if (pendingEnd && !showEndPrompt && !showSettings && page === 'dashboard') setShowEndPrompt(true)
  }, [page, pendingEnd, ready, showEndPrompt, showSettings, state.settings.initialized])

  useEffect(() => {
    if (!ready) return
    if (showEndPrompt && !pendingEnd) setShowEndPrompt(false)
    const idlePage = pageWorkday ? 'launch' : 'rest-day-home'
    if (preWorkWindow && !state.runtime.preWorkOvertimeRunning && page !== 'pre-work-prompt' && page !== 'dashboard') {
      setPage('pre-work-prompt')
      return
    }
    if (state.runtime.preWorkOvertimeRunning && preWorkWindow && page !== 'pre-work-overtime') {
      setPage('pre-work-overtime')
      return
    }
    if (pageWorkday && (state.runtime.workdayStatus === 'sleeping' || state.runtime.workdayStatus === 'overtime-paused') && page !== 'workday-sleep') {
      setPage('workday-sleep')
      return
    }
    if (!state.runtime.preWorkOvertimeRunning && page === 'pre-work-overtime') {
      setPage(preWorkWindow ? 'pre-work-prompt' : 'dashboard')
      return
    }
    if (page === 'launch' || page === 'rest-day-home' || page === 'pre-work-prompt') {
      if (preWorkWindow && !state.runtime.preWorkOvertimeRunning && page !== 'pre-work-prompt') setPage('pre-work-prompt')
      else if (!preWorkWindow && page === 'pre-work-prompt') setPage(incomeWorkday ? 'dashboard' : idlePage)
      else if (!preWorkWindow && page !== idlePage) setPage(idlePage)
      return
    }
    if (page === 'workday-sleep' && state.runtime.workdayStatus !== 'sleeping' && state.runtime.workdayStatus !== 'overtime-paused') setPage(idlePage)
    if (page === 'rest-day-overtime' && !state.runtime.overtimeRunning) setPage(idlePage)
    if (!pageWorkday && page === 'dashboard') setPage('rest-day-home')
  }, [incomeWorkday, page, pageWorkday, pendingEnd, preWorkWindow, ready, showEndPrompt, state.runtime.overtimeRunning, state.runtime.preWorkOvertimeDeclined, state.runtime.preWorkOvertimeRunning, state.runtime.workdayStatus])

  const updateSettings = (patch: Partial<AppSettings>) => setSettingsDraft((draft) => ({ ...draft, ...patch }))
  const tomorrowCycleKey = formatDateKey(addDays(currentCycle, 1))

  const setTomorrowPageOverride = (isPageWorkday: boolean) => {
    setSettingsDraft((draft) => ({ ...draft, pageDayOverrides: { ...draft.pageDayOverrides, [tomorrowCycleKey]: isPageWorkday } }))
  }

  const saveSettings = async () => {
    const salary = Number(settingsDraft.monthlySalary)
    if (!Number.isFinite(salary) || salary <= 0 || !settingsDraft.startTime || !settingsDraft.endTime || settingsDraft.startTime === settingsDraft.endTime) return
    const savedAt = Date.now()
    await reconcile(savedAt, false)
    const next = structuredClone(stateRef.current)
    next.settings = { ...settingsDraft, monthlySalary: salary, initialized: true }
    next.totals = recomputeNormalTotals(next.totals, next.settings, monthKeyFromDate(cycleDate(new Date(savedAt))), formatDateKey(cycleDate(new Date(savedAt))))
    next.runtime.mainProcessedAt = savedAt
    next.runtime.mainCycleKey = formatDateKey(cycleDate(new Date(savedAt)))
    next.runtime.leaveProcessedAt = savedAt
    if (!next.runtime.overtimeRunning) next.runtime.overtimeProcessedAt = savedAt
    await persist(next)
    try {
      await window.note.setAutoLaunch(next.settings.autoLaunch)
    } catch {
      // Preview mode can run without the Electron bridge.
    }
    setShowSettings(false)
  }

  const toggleAdjustable = async () => {
    const next = structuredClone(stateRef.current)
    next.window.adjustable = !next.window.adjustable
    await persist(next)
    try {
      await window.note.setAdjustable(next.window.adjustable)
    } catch {
      // Preview mode can run without the Electron bridge.
    }
  }

  const toggleLeave = async () => {
    if (!active.inShift || !incomeWorkday || state.runtime.workdayStatus !== 'working' || state.runtime.preWorkOvertimeRunning) return
    const at = Date.now()
    await reconcile(at, false)
    const next = structuredClone(stateRef.current)
    next.runtime.leaveRunning = !next.runtime.leaveRunning
    next.runtime.leaveProcessedAt = at
    await persist(next)
  }

  const startPreWorkOvertime = async () => {
    const at = Date.now()
    await reconcile(at, false)
    const next = structuredClone(stateRef.current)
    next.runtime.preWorkOvertimeRunning = true
    next.runtime.preWorkOvertimeDeclined = false
    next.runtime.preWorkOvertimeCycleKey = cycleKey
    next.runtime.preWorkOvertimeStartedAt = at
    next.runtime.preWorkOvertimeProcessedAt = at
    next.runtime.preWorkOvertimeRate = rateForCycle(currentCycle, next.settings)
    next.runtime.leaveRunning = false
    await persist(next)
    setPage('pre-work-overtime')
  }

  const stopPreWorkOvertime = async () => {
    const at = Date.now()
    await reconcile(at, false)
    const next = structuredClone(stateRef.current)
    next.runtime.preWorkOvertimeRunning = false
    next.runtime.preWorkOvertimeStartedAt = 0
    next.runtime.preWorkOvertimeProcessedAt = at
    next.runtime.preWorkOvertimeRate = 0
    await persist(next)
    setPage('pre-work-prompt')
  }

  const declinePreWorkOvertime = async () => {
    const next = structuredClone(stateRef.current)
    next.runtime.preWorkOvertimeRunning = false
    next.runtime.preWorkOvertimeDeclined = true
    next.runtime.preWorkOvertimeCycleKey = cycleKey
    next.runtime.preWorkOvertimeStartedAt = 0
    next.runtime.preWorkOvertimeProcessedAt = Date.now()
    next.runtime.preWorkOvertimeRate = 0
    await persist(next)
    setPage('launch')
  }

  const startWorkdayOvertime = async (backfillFromEnd = true) => {
    const at = Date.now()
    await reconcile(at, false)
    const next = structuredClone(stateRef.current)
    const endAt = next.runtime.workdayEndAt
    const endKey = next.runtime.workdayEndCycleKey
    if (!endAt || !endKey) return
    const segmentStart = backfillFromEnd ? endAt : at
    next.runtime.decisionCycle = endKey
    next.runtime.decision = 'overtime'
    next.runtime.workdayStatus = 'overtime-running'
    next.runtime.overtimeRunning = true
    next.runtime.overtimeMode = 'workday'
    next.runtime.overtimeCycleKey = endKey
    next.runtime.overtimeSegmentStartedAt = segmentStart
    next.runtime.overtimeProcessedAt = segmentStart
    next.runtime.overtimePausedAt = 0
    next.runtime.leaveRunning = false
    await persist(next)
    await reconcile(at, false)
    setShowEndPrompt(false)
    setPage('dashboard')
  }

  const finishWorkday = async () => {
    const at = Date.now()
    await reconcile(at, false)
    const next = structuredClone(stateRef.current)
    next.runtime.decision = 'off'
    next.runtime.workdayStatus = 'sleeping'
    next.runtime.overtimeRunning = false
    next.runtime.overtimeMode = 'none'
    next.runtime.leaveRunning = false
    next.runtime.overtimePausedAt = 0
    await persist(next)
    setShowEndPrompt(false)
    setPage('workday-sleep')
  }

  const pauseWorkdayOvertime = async () => {
    const at = Date.now()
    await reconcile(at, false)
    const next = structuredClone(stateRef.current)
    next.runtime.workdayStatus = 'sleeping'
    next.runtime.overtimeRunning = false
    next.runtime.overtimeMode = 'none'
    next.runtime.overtimePausedAt = at
    await persist(next)
    setPage('workday-sleep')
  }

  const startNonworkdayOvertime = async () => {
    const at = Date.now()
    await reconcile(at, false)
    const next = structuredClone(stateRef.current)
    next.runtime.overtimeRunning = true
    next.runtime.overtimeMode = 'nonworkday'
    next.runtime.overtimeCycleKey = cycleKey
    next.runtime.overtimeProcessedAt = at
    next.runtime.overtimeSegmentStartedAt = at
    next.runtime.workdayOvertimeRate = rateForCycle(currentCycle, next.settings)
    next.runtime.dismissedNonworkdayCycle = ''
    await persist(next)
    setPage('rest-day-overtime')
  }

  const dismissNonworkdayMode = async () => {
    const at = Date.now()
    await reconcile(at, false)
    const next = structuredClone(stateRef.current)
    next.runtime.overtimeRunning = false
    next.runtime.overtimeMode = 'none'
    next.runtime.dismissedNonworkdayCycle = cycleKey
    next.runtime.overtimePausedAt = at
    await persist(next)
    setPage('rest-day-home')
  }

  const enterWork = () => {
    if (!pageWorkday) {
      setPage(state.runtime.overtimeRunning ? 'rest-day-overtime' : 'rest-day-home')
      return
    }
    if (state.runtime.workdayStatus === 'sleeping') {
      setPage('workday-sleep')
      return
    }
    setPage('dashboard')
    if (state.runtime.workdayStatus === 'awaiting-decision') setShowEndPrompt(true)
  }

  const markAdjustmentWorkday = async () => {
    const at = Date.now()
    await reconcile(at, false)
    const next = structuredClone(stateRef.current)
    next.settings.holidayOverrides[cycleKey] = true
    delete next.settings.pageDayOverrides[cycleKey]
    next.totals.normalSecondsByCycle[cycleKey] = Math.max(next.totals.normalSecondsByCycle[cycleKey] || 0, coverageThrough(currentCycle, at, next.settings))
    next.totals = recomputeNormalTotals(next.totals, next.settings, currentMonthKey, cycleKey)
    next.runtime.mainProcessedAt = at
    next.runtime.leaveRunning = false
    next.runtime.overtimeRunning = false
    next.runtime.overtimeMode = 'none'
    next.runtime.workdayStatus = 'working'
    next.runtime.workdayEndCycleKey = ''
    next.runtime.workdayEndAt = 0
    next.runtime.workdayOvertimeRate = 0
    next.runtime.overtimeSegmentStartedAt = 0
    next.runtime.overtimePausedAt = 0
    await persist(next)
    await reconcile(at, false)
    setPage('dashboard')
  }

  const refreshQuote = async () => {
    const next = structuredClone(stateRef.current)
    const quote = pickQuote(next.settings.quotePool, cycleKey, next.runtime.dailyQuoteId)
    next.runtime.dailyQuote = quote?.text || ''
    next.runtime.dailyQuoteId = quote?.id || ''
    next.runtime.quoteCycleKey = cycleKey
    await persist(next)
  }

  const addQuote = async (quote: string) => {
    const normalized = quote.trim()
    if (!normalized || normalized.length > 120) return false
    const next = structuredClone(stateRef.current)
    let record = next.settings.quotePool.find((item) => item.text === normalized)
    if (!record) {
      record = createQuoteRecord(normalized)
      next.settings.quotePool.push(record)
    }
    next.runtime.dailyQuote = record.text
    next.runtime.dailyQuoteId = record.id
    next.runtime.quoteCycleKey = cycleKey
    await persist(next)
    return true
  }

  const updateQuotePool = async (quotePool: QuoteRecord[]) => {
    const next = structuredClone(stateRef.current)
    next.settings.quotePool = sanitizeQuotePool(quotePool, 8)
    const currentQuote = next.settings.quotePool.find((item) => item.id === next.runtime.dailyQuoteId)
    if (!currentQuote) {
      const quote = pickQuote(next.settings.quotePool, cycleKey)
      next.runtime.dailyQuote = quote?.text || ''
      next.runtime.dailyQuoteId = quote?.id || ''
      next.runtime.quoteCycleKey = cycleKey
    } else {
      next.runtime.dailyQuote = currentQuote.text
    }
    await persist(next)
    setSettingsDraft(next.settings)
  }

  const toggleMoneyAnimation = async () => {
    const next = structuredClone(stateRef.current)
    next.settings.moneyAnimation = !next.settings.moneyAnimation
    await persist(next)
  }

  const handleClose = () => {
    try {
      void window.note.closeApp()
    } catch {
      window.close()
    }
  }
  const isWorkdayOvertimeRunning = state.runtime.workdayStatus === 'overtime-running' && state.runtime.overtimeMode === 'workday'
  const preWorkOvertimeActive = state.runtime.preWorkOvertimeRunning && preWorkWindow
  const settingsOverlay = showSettings ? <SettingsPanel draft={settingsDraft} tomorrowCycleKey={tomorrowCycleKey} onTomorrowOverride={setTomorrowPageOverride} onChange={updateSettings} onQuotePoolChange={updateQuotePool} onSave={saveSettings} onCancel={() => { if (state.settings.initialized) setShowSettings(false) }} /> : null

  if (!ready) return <div className="boot-screen"><Sparkles size={16} /> 正在打开今日账本…</div>
  if (page === 'pre-work-prompt') return <PreWorkPromptView theme={theme} onAccept={() => void startPreWorkOvertime()} />
  if (page === 'pre-work-overtime') return <PreWorkOvertimeView theme={theme} amount={state.totals.overtime} animate={state.settings.moneyAnimation} onExit={() => void stopPreWorkOvertime()} />
  if (page === 'launch') return <LaunchView theme={theme} onStart={enterWork} onSettings={() => { setSettingsDraft(state.settings); setShowSettings(true) }}>{settingsOverlay}</LaunchView>
  if (page === 'workday-sleep') return <SleepView theme={theme} onReturnToOvertime={() => void startWorkdayOvertime(state.runtime.overtimePausedAt <= 0)} />
  if (page === 'rest-day-home') return <RestDayView theme={theme} onOvertime={() => void startNonworkdayOvertime()} onAdjustment={() => void markAdjustmentWorkday()} onSettings={() => { setSettingsDraft(state.settings); setShowSettings(true) }}>{settingsOverlay}</RestDayView>
  if (page === 'rest-day-overtime') return <NonworkdayView theme={theme} themeId={state.settings.theme} animate={state.settings.moneyAnimation} amount={state.totals.overtime} now={now} cycle={currentCycle} adjustable={state.window.adjustable} onAdjust={toggleAdjustable} onCloseMode={dismissNonworkdayMode} onQuit={handleClose} />

  return (
    <main className={`app-shell mode-${theme.mode} theme-${state.settings.theme} ${state.window.adjustable ? 'is-adjustable' : 'is-locked'}`} style={themeStyle(theme)}>
      <div className="paper-grain" />
      <header className="app-header drag-region">
        <div className="brand-mark no-drag"><span className="brand-dot" /><span>今日账本</span></div>
        <div className="header-actions no-drag">
          <button className="icon-button" onClick={toggleAdjustable} title={state.window.adjustable ? '锁定位置与大小' : '进入调整模式'}>{state.window.adjustable ? <Lock size={15} /> : <Move size={15} />}</button>
          <button className="icon-button" onClick={() => { setSettingsDraft(state.settings); setShowSettings(true) }} title="打开设置"><Settings size={15} /></button>
          <button className="icon-button close-button" onClick={handleClose} title="退出应用"><X size={15} /></button>
        </div>
      </header>

      <section className="dashboard-scroll">
        <section className="daily-ledger">
          <div className="section-kicker"><span className="kicker-line" /> 今天的进度 <span className="status-pill">{incomeWorkday && active.inShift ? '工作中' : '已暂停'}</span></div>
          <div className="daily-summary-row">
            <ClockCard featured eyebrow="今天正常挣得" value={state.totals.dailyMain} tone="main" animate={state.settings.moneyAnimation} hint={`${formatShortDate(now)} · ${state.settings.startTime}–${state.settings.endTime}`} context={<span className="daily-cycle-note"><span className="digital-mark" /> 06:00 刷新</span>} control={<button type="button" className="animation-toggle" onClick={toggleMoneyAnimation} aria-pressed={state.settings.moneyAnimation} title={state.settings.moneyAnimation ? '关闭金额跳转动画' : '开启金额跳转动画'}>{state.settings.moneyAnimation ? <Zap size={12} /> : <ZapOff size={12} />}</button>} />
            <p className="monthly-sentence">本月累计：<strong>{formatMoney(monthThroughYesterday)}</strong></p>
          </div>
        </section>

        <section className="secondary-clocks">
          <ClockCard eyebrow="离席收益" value={state.totals.leave} tone="leave" animate={state.settings.moneyAnimation} positive hint={preWorkOvertimeActive ? '提前加班期间不可用' : leaveActive ? '正在累计' : active.inShift && incomeWorkday && state.runtime.workdayStatus === 'working' ? '工作时段可用' : '下班后暂停'} action={preWorkOvertimeActive ? undefined : <button className={`action-button ${leaveActive ? 'active' : ''}`} onClick={toggleLeave} disabled={!active.inShift || !incomeWorkday || state.runtime.workdayStatus !== 'working'}>{leaveActive ? '回到工位' : '开始离席'}</button>} />
          <ClockCard eyebrow="加班扣减" value={state.totals.overtime} tone="overtime" animate={state.settings.moneyAnimation} hint={preWorkOvertimeActive ? '提前加班中，正式上班后自动结束' : isWorkdayOvertimeRunning ? '正在累计负值' : state.runtime.workdayStatus === 'sleeping' ? '今晚先好好休息' : pendingEnd ? '等待下班选择' : '下班后可开启'} action={preWorkOvertimeActive ? undefined : <button className="action-button subtle" onClick={() => { if (isWorkdayOvertimeRunning) void pauseWorkdayOvertime() }} disabled={!isWorkdayOvertimeRunning}>{isWorkdayOvertimeRunning ? '劳累下班' : '等待选择'}</button>} />
        </section>

        <section className="daily-quote"><QuoteBar date={quoteDate} quote={state.runtime.dailyQuote} onRefresh={refreshQuote} onAdd={addQuote} /></section>

        <footer className="app-footer">
          <span><CalendarDays size={13} /> {incomeWorkday ? '周一至周五 · 含调休' : '今天休息 · 可手动加班'}</span>
          <span className="footer-separator" />
          <span><span className="digital-mark" /> 每天 06:00 更新</span>
        </footer>
      </section>

      {showSettings && <SettingsPanel draft={settingsDraft} tomorrowCycleKey={tomorrowCycleKey} onTomorrowOverride={setTomorrowPageOverride} onChange={updateSettings} onQuotePoolChange={updateQuotePool} onSave={saveSettings} onCancel={() => { if (state.settings.initialized) setShowSettings(false) }} />}
      {showEndPrompt && <EndPrompt onFinish={finishWorkday} onOvertime={() => void startWorkdayOvertime(true)} />}
      {wasSuspended && <div className="resume-toast"><Power size={14} /> 已从暂停恢复，正在校准主时钟</div>}
    </main>
  )
}

function AnimatedMoney({ value, featured = false, animate = true }: { value: number; featured?: boolean; animate?: boolean }) {
  const formatted = formatMoney(value)
  const [displayValue, setDisplayValue] = useState(formatted)
  const [previousValue, setPreviousValue] = useState(formatted)
  const [changing, setChanging] = useState(false)
  const valueRef = useRef(formatted)

  useEffect(() => {
    if (!animate) {
      valueRef.current = formatted
      setDisplayValue(formatted)
      setPreviousValue(formatted)
      setChanging(false)
      return
    }
    if (valueRef.current === formatted) return
    setPreviousValue(valueRef.current)
    setDisplayValue(formatted)
    valueRef.current = formatted
    setChanging(true)
    const timer = window.setTimeout(() => setChanging(false), 340)
    return () => window.clearTimeout(timer)
  }, [animate, formatted])

  return <span className={`money-roll ${featured ? 'money-roll-featured' : ''} ${moneyClass(value)} ${changing ? 'is-changing' : ''}`} aria-live="polite"><span className="money-current">{displayValue}</span>{changing && <span className="money-previous" aria-hidden="true">{previousValue}</span>}</span>
}

function ClockCard({ eyebrow, value, tone, hint, action, context, control, featured, positive, animate = true }: { eyebrow: string; value: number; tone: 'main' | 'leave' | 'overtime'; hint: string; action?: React.ReactNode; context?: React.ReactNode; control?: React.ReactNode; featured?: boolean; positive?: boolean; animate?: boolean }) {
  return <article className={`clock-card clock-card-${tone} ${featured ? 'clock-card-featured' : ''}`}>
    <div className="clock-card-header"><span className="clock-eyebrow">{eyebrow}</span><span className="digital-mark header-digital-mark" /></div>
    <div className="clock-face"><span className="digital-corner digital-corner-tl" /><span className="digital-corner digital-corner-br" /><div className="money-display">{tone === 'overtime' && <span className="clock-sign" aria-hidden="true">−</span>}<AnimatedMoney value={tone === 'overtime' || positive ? Math.abs(value) : value} featured={featured} animate={animate} /></div>{control}</div>
    {context && <div className="clock-context">{context}</div>}
    <div className="clock-card-footer"><span className="clock-hint">{hint}</span>{action}</div>
  </article>
}

function QuoteBar({ date, quote, onRefresh, onAdd }: { date: string; quote: string; onRefresh: () => void; onAdd: (quote: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [overflowing, setOverflowing] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const submit = async () => {
    if (await onAdd(draft)) {
      setDraft('')
      setEditing(false)
    }
  }

  useEffect(() => {
    const measure = () => {
      if (!viewportRef.current || !textRef.current) return
      const distance = Math.max(0, textRef.current.scrollWidth - viewportRef.current.clientWidth)
      viewportRef.current.style.setProperty('--quote-shift', `-${distance}px`)
      setOverflowing(distance > 0)
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (viewportRef.current) observer.observe(viewportRef.current)
    return () => observer.disconnect()
  }, [quote])

  return <div className="quote-line"><span className="quote-date">{date}</span><Sparkles size={13} /><div className={`quote-viewport ${overflowing ? 'is-overflowing' : ''}`} ref={viewportRef}><span ref={textRef}>{quote || 'Try to record your mood in one sentence'}</span></div>{editing && <div className="quote-add"><input value={draft} maxLength={120} placeholder="关于我的心情..." onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void submit(); if (event.key === 'Escape') setEditing(false) }} /><button type="button" className="quote-confirm" onClick={() => void submit()} title="加入文案池"><Plus size={13} /></button><button type="button" className="quote-cancel" onClick={() => { setDraft(''); setEditing(false) }} title="取消"><X size={13} /></button></div>}<button type="button" className="quote-edit" onClick={() => setEditing((value) => !value)} title="新增文案"><Pencil size={13} /></button><button type="button" className="quote-refresh" onClick={onRefresh} title="换一句"><RefreshCw size={13} /></button></div>
}

function PreWorkPromptView({ theme, onAccept }: { theme: typeof THEMES[ThemeId]; onAccept: () => void }) {
  return <main className={`app-shell mode-${theme.mode} pre-work-shell`} style={themeStyle(theme)}><div className="paper-grain" /><section className="focus-page"><div className="focus-brand">提前来了那不是加班吗？</div><button type="button" className="focus-button" onClick={onAccept}>是的</button><small className="focus-note">可以等待工作时间开始自动跳转</small></section></main>
}

function PreWorkOvertimeView({ theme, amount, animate, onExit }: { theme: typeof THEMES[ThemeId]; amount: number; animate: boolean; onExit: () => void }) {
  return <main className={`app-shell mode-${theme.mode} pre-work-running-shell`} style={themeStyle(theme)}><div className="paper-grain" /><section className="focus-page"><div className="focus-brand">提前加班</div><div className="pre-work-money"><span className="clock-sign" aria-hidden="true">−</span><AnimatedMoney value={Math.abs(amount)} featured animate={animate} /></div><button type="button" className="quiet-button" onClick={onExit}>退出</button></section></main>
}

function LaunchView({ theme, onStart, onSettings, children }: { theme: typeof THEMES[ThemeId]; onStart: () => void; onSettings: () => void; children?: React.ReactNode }) {
  return <main className={`app-shell mode-${theme.mode} launch-shell`} style={themeStyle(theme)}><header className="focus-header"><button type="button" className="icon-button" onClick={onSettings} title="打开设置"><Settings size={15} /></button></header><div className="paper-grain" /><section className="focus-page"><div className="focus-brand">RedefineTime</div><p>试试重新定义工作时间</p><button type="button" className="focus-button" onClick={onStart}>上班</button></section>{children}</main>
}

function SleepView({ theme, onReturnToOvertime }: { theme: typeof THEMES[ThemeId]; onReturnToOvertime: () => void }) {
  const [message] = useState(() => SLEEP_MESSAGES[Math.floor(Math.random() * SLEEP_MESSAGES.length)])
  return <main className={`app-shell mode-${theme.mode} sleep-shell`} style={themeStyle(theme)}><div className="paper-grain" /><section className="focus-page"><div className="focus-brand">{message}</div><button type="button" className="focus-button secondary-focus" onClick={onReturnToOvertime}>骗你的，其实还得加班（哭）</button></section></main>
}

function RestDayView({ theme, onOvertime, onAdjustment, onSettings, children }: { theme: typeof THEMES[ThemeId]; onOvertime: () => void; onAdjustment: () => void; onSettings: () => void; children?: React.ReactNode }) {
  return <main className={`app-shell mode-${theme.mode} rest-day-shell`} style={themeStyle(theme)}><header className="focus-header"><button type="button" className="icon-button" onClick={onSettings} title="打开设置"><Settings size={15} /></button></header><div className="paper-grain" /><section className="focus-page"><div className="focus-brand">今天是休息日，好好享受</div><p>休息也是工作之外的重要安排。</p><div className="focus-actions"><button type="button" className="focus-button secondary-focus" onClick={onOvertime}>很不幸今天还得加班</button><button type="button" className="quiet-button" onClick={onAdjustment}>调休</button></div></section>{children}</main>
}

function EndPrompt({ onFinish, onOvertime }: { onFinish: () => void; onOvertime: () => void }) {
  return <div className="modal-backdrop"><section className="end-prompt">
    <div className="prompt-icon"><TimerOff size={18} /></div>
    <p className="eyebrow">工作段结束</p>
    <h2>今天下班吗？</h2>
    <p>正常收入已停在当前金额。继续工作会按每秒收入的同等数值计入加班扣减。</p>
    <div className="prompt-actions"><button className="secondary-button" onClick={onFinish}><Check size={15} /> 下班</button><button className="primary-button" onClick={onOvertime}><ArrowDownRight size={15} /> 继续加班</button></div>
  </section></div>
}

function NonworkdayView({ theme, themeId, animate, amount, now, cycle, adjustable, onAdjust, onCloseMode, onQuit }: { theme: typeof THEMES[ThemeId]; themeId: ThemeId; animate: boolean; amount: number; now: Date; cycle: Date; adjustable: boolean; onAdjust: () => void; onCloseMode: () => void; onQuit: () => void }) {
  return <main className={`app-shell mode-${theme.mode} theme-${themeId}`} style={themeStyle(theme)}>
    <div className="paper-grain" />
    <header className="app-header drag-region"><div className="brand-mark no-drag"><span className="brand-dot overtime-dot" /><span>非工作日加班</span></div><div className="header-actions no-drag"><button className="icon-button" onClick={onAdjust} title={adjustable ? '锁定位置与大小' : '进入调整模式'}>{adjustable ? <Lock size={15} /> : <Move size={15} />}</button><button className="icon-button" onClick={onCloseMode} title="关闭加班模式"><Minus size={15} /></button><button className="icon-button close-button" onClick={onQuit} title="退出应用"><X size={15} /></button></div></header>
    <section className="overtime-focus"><div className="overtime-clock-face"><span className="digital-mark digital-mark-large" /><span className="overtime-pulse" /></div><div className="overtime-kicker"><ArrowDownRight size={16} /> 加班时钟</div><div className="overtime-money"><AnimatedMoney value={-Math.abs(amount)} featured animate={animate} /></div><p>应用运行期间计时 · {formatShortDate(now)}</p><button type="button" className="focus-button secondary-focus" onClick={onCloseMode}>劳累下班</button><div className="overtime-note"><span className="pulse" /> 下次刷新 {cycle.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} 06:00</div></section>
  </main>
}

function SettingsPanel({ draft, tomorrowCycleKey, onTomorrowOverride, onChange, onQuotePoolChange, onSave, onCancel }: { draft: AppSettings; tomorrowCycleKey: string; onTomorrowOverride: (isPageWorkday: boolean) => void; onChange: (patch: Partial<AppSettings>) => void; onQuotePoolChange: (quotePool: QuoteRecord[]) => Promise<void>; onSave: () => void; onCancel: () => void }) {
  const [overrideDate, setOverrideDate] = useState('')
  const [overrideValue, setOverrideValue] = useState<'work' | 'rest'>('rest')
  const [showQuoteManager, setShowQuoteManager] = useState(false)
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null)
  const [quoteDraft, setQuoteDraft] = useState('')
  const overrides = Object.entries(draft.holidayOverrides).sort(([a], [b]) => a.localeCompare(b))
  const saveQuoteEdit = async () => {
    if (!editingQuoteId) return
    const nextQuote = quoteDraft.trim()
    if (!nextQuote || nextQuote.length > 120) return
    const nextPool = draft.quotePool.map((quote) => quote.id === editingQuoteId ? { ...quote, text: nextQuote } : quote)
    if (new Set(nextPool.map((quote) => quote.text)).size !== nextPool.length) return
    onChange({ quotePool: nextPool })
    await onQuotePoolChange(nextPool)
    setEditingQuoteId(null)
    setQuoteDraft('')
  }
  const deleteQuote = async (id: string) => {
    const nextPool = draft.quotePool.filter((quote) => quote.id !== id)
    onChange({ quotePool: nextPool })
    await onQuotePoolChange(nextPool)
  }
  const addOverride = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(overrideDate)) return
    onChange({ holidayOverrides: { ...draft.holidayOverrides, [overrideDate]: overrideValue === 'work' } })
    setOverrideDate('')
  }
  const removeOverride = (date: string) => {
    const next = { ...draft.holidayOverrides }
    delete next[date]
    onChange({ holidayOverrides: next })
  }

  return <div className="modal-backdrop settings-backdrop"><section className="settings-panel">
    <header className="settings-header"><div><p className="eyebrow"><Settings size={13} /> 账本设置</p><h2>我们钱多到得按秒算</h2></div><button className="icon-button" onClick={onCancel} title="关闭设置"><X size={16} /></button></header>
    <div className="settings-grid">
      <label className="field full-field"><span>月薪（人民币）</span><div className="input-wrap"><span>¥</span><input type="number" min="1" step="100" value={draft.monthlySalary} onChange={(event) => onChange({ monthlySalary: Number(event.target.value) })} /></div></label>
      <label className="field"><span>上班时间</span><input type="time" value={draft.startTime} onChange={(event) => onChange({ startTime: event.target.value })} /></label>
      <label className="field"><span>下班时间</span><input type="time" value={draft.endTime} onChange={(event) => onChange({ endTime: event.target.value })} /></label>
      <div className="setting-note full-field"><CalendarDays size={16} /><span>已启用中国法定节假日与调休日历<br /><small>按工作段开始日期计算，支持跨午夜班次</small></span></div>
      <div className="override-box full-field"><div className="override-heading"><span>手动修正特殊日期</span><small>修正优先于内置日历</small></div><div className="override-form"><input type="date" value={overrideDate} onChange={(event) => setOverrideDate(event.target.value)} /><select value={overrideValue} onChange={(event) => setOverrideValue(event.target.value as 'work' | 'rest')}><option value="rest">设为休息日</option><option value="work">设为工作日</option></select><button className="secondary-button" onClick={addOverride}>添加</button></div>{overrides.length > 0 && <div className="override-list">{overrides.map(([date, isWork]) => <span className="override-chip" key={date}>{date} · {isWork ? '工作日' : '休息日'}<button onClick={() => removeOverride(date)} title={`删除 ${date} 修正`}><X size={11} /></button></span>)}</div>}</div>
      <div className="tomorrow-override full-field"><div><strong>明天是否调休？</strong><small>{tomorrowCycleKey} 06:00 起生效，不影响收入</small></div><div className="tomorrow-actions"><button type="button" className={`secondary-button ${draft.pageDayOverrides[tomorrowCycleKey] === true ? 'selected-quick' : ''}`} onClick={() => onTomorrowOverride(true)}>明天调休</button><button type="button" className={`secondary-button ${draft.pageDayOverrides[tomorrowCycleKey] === false ? 'selected-quick' : ''}`} onClick={() => onTomorrowOverride(false)}>明天其实不调休</button></div></div>
      <div className="quote-manager-launch full-field"><div><strong>每日文案池</strong><small>新增、修改或删除每日随机文案</small></div><button type="button" className="secondary-button" onClick={() => setShowQuoteManager(true)}><Pencil size={13} /> 管理文案</button></div>
      <label className="toggle-row full-field"><span><Power size={15} /> 开机自动启动</span><input type="checkbox" checked={draft.autoLaunch} onChange={(event) => onChange({ autoLaunch: event.target.checked })} /><span className="toggle-ui" /></label>
    </div>
    <div className="theme-heading"><Palette size={15} /><span>选择便签主题</span><small>只改变视觉，不改变计时</small></div>
    <div className="theme-grid">{Object.entries(THEMES).map(([id, option]) => <button key={id} className={`theme-card ${draft.theme === id ? 'selected' : ''} ${option.mode === 'image' ? 'image-theme-card' : ''}`} onClick={() => onChange({ theme: id as ThemeId })}><span className="theme-swatch" style={{ background: option.backgroundImage ? `linear-gradient(135deg, rgb(8 13 56 / 40%), rgb(8 12 47 / 80%)), url("${option.backgroundImage}") center / cover` : option.mode === 'solid' ? option.colors[0] : `linear-gradient(135deg, ${option.colors.join(', ')})` }} /><span className="theme-copy"><strong>{option.name}</strong></span>{draft.theme === id && <Check size={15} />}</button>)}</div>
    <footer className="settings-footer"><button className="secondary-button" onClick={onCancel}>取消</button><button className="primary-button" onClick={onSave}><Check size={15} /> 保存设置</button></footer>
    {showQuoteManager && <div className="quote-manager-backdrop"><section className="quote-manager"><header><div><p className="eyebrow"><Pencil size={13} /> 每日文案池</p><h3>管理你的心情记录</h3></div><button type="button" className="icon-button" onClick={() => { setShowQuoteManager(false); setEditingQuoteId(null) }} title="关闭文案管理"><X size={15} /></button></header><div className="quote-manager-list">{draft.quotePool.length === 0 ? <p className="quote-manager-empty">还没有记录，试着在主页写一句心情吧。</p> : draft.quotePool.map((quote) => <div className="quote-manager-item" key={quote.id}>{editingQuoteId === quote.id ? <><input value={quoteDraft} maxLength={120} onChange={(event) => setQuoteDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void saveQuoteEdit(); if (event.key === 'Escape') setEditingQuoteId(null) }} /><button type="button" className="quote-confirm" onClick={() => void saveQuoteEdit()} title="保存修改"><Save size={13} /></button><button type="button" className="quote-cancel" onClick={() => setEditingQuoteId(null)} title="取消修改"><X size={13} /></button></> : <><div className="quote-record"><span>{quote.text}</span><small>创建于 {formatQuoteCreatedAt(quote.createdAt)}</small></div><button type="button" className="quote-edit" onClick={() => { setEditingQuoteId(quote.id); setQuoteDraft(quote.text) }} title="修改文案"><Pencil size={13} /></button><button type="button" className="quote-delete" onClick={() => void deleteQuote(quote.id)} title="删除文案"><Trash2 size={13} /></button></>}</div>)}</div></section></div>}
  </section></div>
}

export default App
