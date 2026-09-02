import cyanThemeImage from './assets/cyan-theme.png'
import starryNightImage from './assets/starry-night.png'

export type ThemeMode = 'solid' | 'gradient' | 'image'

export const THEMES: Record<ThemeId, { name: string; description: string; colors: string[]; ink: string; muted: string; accent: string; mode: ThemeMode; backgroundImage?: string; background?: string }> = {
  charcoal: { name: '不那么高兴的一天', description: '', colors: ['#696969'], ink: '#FAFAFA', muted: '#D4D4D4', accent: '#F3C969', mode: 'solid' },
  beige: { name: '希望能让你的眼睛轻松些', description: '', colors: ['#FFE4C4'], ink: '#4B3628', muted: '#806451', accent: '#B96C43', mode: 'solid' },
  warm: { name: '想做一场粉红色的梦', description: '', colors: ['#FFF0F5', '#FFC1CC', '#F4A2A2'], ink: '#4D2B35', muted: '#8F5A66', accent: '#A94F66', mode: 'gradient' },
  minimal: { name: '干干净净就好', description: '', colors: ['#F7F9FA', '#E3E7EA', '#C9D0D6'], ink: '#20282D', muted: '#66747C', accent: '#3C697B', mode: 'gradient' },
  coffee: { name: '希望慢慢喝咖啡能成为种享受', description: '', colors: ['#3E2723', '#6D4C41', '#A1887F'], ink: '#FFF9F2', muted: '#E8D7C7', accent: '#F0B36D', mode: 'gradient' },
  nature: { name: '记得偶尔出门看看', description: '', colors: ['#E8F5E9', '#AED581', '#66BB6A'], ink: '#173C29', muted: '#4E785F', accent: '#2F8050', mode: 'gradient' },
  nordic: { name: '冷静一点，别着急', description: '', colors: ['#E1F5FE', '#81D4FA', '#29B6F6'], ink: '#07344B', muted: '#2D6B84', accent: '#0C7DAF', mode: 'gradient' },
  purple: { name: '想种一整个院子的薰衣草', description: '', colors: ['#FBF5FC', '#EAD4EE', '#D7B6E2', '#BF95D0'], ink: '#4A2E5B', muted: '#80618D', accent: '#9B72AE', mode: 'gradient', background: 'linear-gradient(160deg, #FBF5FC, #EAD4EE, #D7B6E2, #BF95D0)' },
  cyan: { name: '呼~', description: '', colors: ['#D7E5E9', '#8CB2C7', '#426B7B', '#3A662B'], ink: '#16313E', muted: '#315D6C', accent: '#4D7834', mode: 'image', backgroundImage: cyanThemeImage },
  starry: { name: '我们一起去看星星吧', description: '', colors: ['#1A237E', '#3949AB', '#FDD835', '#1B5E20', '#5D4037'], ink: '#FFF9DD', muted: '#DDE4FF', accent: '#FDD835', mode: 'image', backgroundImage: starryNightImage },
}

const FIXED_HOLIDAYS: Record<number, { holidays: string[]; workdays: string[] }> = {
  2026: {
    holidays: ['2026-01-01', '2026-01-02', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-23', '2026-04-06', '2026-05-01', '2026-05-04', '2026-05-05', '2026-06-19', '2026-09-25', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06', '2026-10-07'],
    workdays: ['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10'],
  },
}

export function parseDateKey(key: string) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day, 12, 0, 0, 0)
}

export function formatDateKey(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function addDays(date: Date, amount: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

export function cycleDate(now: Date) {
  const date = new Date(now)
  if (date.getHours() < 6) return addDays(date, -1)
  return date
}

export function cycleKey(now: Date) {
  return formatDateKey(cycleDate(now))
}

export function monthKeyFromDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function isWorkday(date: Date, overrides: Record<string, boolean> = {}) {
  const key = formatDateKey(date)
  if (typeof overrides[key] === 'boolean') return overrides[key]
  const fixed = FIXED_HOLIDAYS[date.getFullYear()]
  if (fixed?.holidays.includes(key)) return false
  if (fixed?.workdays.includes(key)) return true
  const day = date.getDay()
  return day !== 0 && day !== 6
}

export function getTimeParts(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  return { hours: hours || 0, minutes: minutes || 0 }
}

export function setClock(date: Date, time: string) {
  const { hours, minutes } = getTimeParts(time)
  const next = new Date(date)
  next.setHours(hours, minutes, 0, 0)
  return next
}

export function getShiftForCycle(cycle: Date, settings: AppSettings) {
  const start = setClock(cycle, settings.startTime)
  let end = setClock(cycle, settings.endTime)
  if (end.getTime() <= start.getTime()) end = addDays(end, 1)
  return { start, end, seconds: Math.max(1, (end.getTime() - start.getTime()) / 1000) }
}

export function activeShift(now: Date, settings: AppSettings) {
  const currentCycle = cycleDate(now)
  const current = getShiftForCycle(currentCycle, settings)
  if (now >= current.start && now < current.end) return { cycle: currentCycle, shift: current, inShift: true }
  const previousCycle = addDays(currentCycle, -1)
  const previous = getShiftForCycle(previousCycle, settings)
  if (now >= previous.start && now < previous.end) return { cycle: previousCycle, shift: previous, inShift: true }
  return { cycle: currentCycle, shift: current, inShift: false }
}

export function pendingEndCycle(now: Date, settings: AppSettings) {
  const currentCycle = cycleDate(now)
  const current = getShiftForCycle(currentCycle, settings)
  if (now >= current.end) return { cycle: currentCycle, shift: current }
  const previousCycle = addDays(currentCycle, -1)
  const previous = getShiftForCycle(previousCycle, settings)
  if (now >= previous.end) return { cycle: previousCycle, shift: previous }
  return null
}

export function secondsInRange(from: number, to: number, start: number, end: number) {
  const left = Math.max(from, start)
  const right = Math.min(to, end)
  return Math.max(0, (right - left) / 1000)
}

export function workdayCount(year: number, month: number, overrides: Record<string, boolean>) {
  const days = new Date(year, month, 0).getDate()
  let count = 0
  for (let day = 1; day <= days; day += 1) {
    if (isWorkday(new Date(year, month - 1, day, 12), overrides)) count += 1
  }
  return Math.max(1, count)
}

export function rateForCycle(cycle: Date, settings: AppSettings) {
  const workdays = workdayCount(cycle.getFullYear(), cycle.getMonth() + 1, settings.holidayOverrides)
  const shift = getShiftForCycle(cycle, settings)
  return settings.monthlySalary / workdays / shift.seconds
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

export function formatShortDate(date: Date) {
  return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })
}

export function normalCoverageSecondsByCycle(fromMs: number, toMs: number, settings: AppSettings) {
  const seconds: Record<string, number> = {}
  if (toMs <= fromMs) return seconds
  const firstCycle = addDays(cycleDate(new Date(fromMs)), -1)
  const endDate = new Date(toMs)
  for (let day = new Date(firstCycle); day <= endDate; day = addDays(day, 1)) {
    const shift = getShiftForCycle(day, settings)
    const covered = secondsInRange(fromMs, toMs, shift.start.getTime(), shift.end.getTime())
    if (covered > 0) seconds[formatDateKey(day)] = covered
  }
  return seconds
}

export function normalWorkAmountsByCycle(fromMs: number, toMs: number, settings: AppSettings) {
  const amounts: Record<string, number> = {}
  for (const [key, seconds] of Object.entries(normalCoverageSecondsByCycle(fromMs, toMs, settings))) {
    const cycle = parseDateKey(key)
    if (isWorkday(cycle, settings.holidayOverrides)) amounts[key] = seconds * rateForCycle(cycle, settings)
  }
  return amounts
}

export function normalWorkSeconds(from: number, to: number, settings: AppSettings) {
  return Object.values(normalCoverageSecondsByCycle(from, to, settings)).reduce((total, seconds) => total + seconds, 0)
}

export function coverageThrough(cycle: Date, atMs: number, settings: AppSettings) {
  const shift = getShiftForCycle(cycle, settings)
  return secondsInRange(shift.start.getTime(), Math.min(atMs, shift.end.getTime()), shift.start.getTime(), shift.end.getTime())
}

export function overtimeAmountForRange(fromMs: number, toMs: number, rate: number) {
  if (toMs <= fromMs || !Number.isFinite(rate) || rate <= 0) return 0
  return ((toMs - fromMs) / 1000) * rate
}

export function recomputeNormalTotals(totals: Totals, settings: AppSettings, monthKey: string, currentCycleKey: string) {
  const normalSecondsByCycle = { ...(totals.normalSecondsByCycle || {}) }
  const mainByCycle = { ...(totals.mainByCycle || {}) }

  for (const [key, seconds] of Object.entries(normalSecondsByCycle)) {
    if (!key.startsWith(monthKey)) continue
    const cycle = parseDateKey(key)
    mainByCycle[key] = isWorkday(cycle, settings.holidayOverrides) ? seconds * rateForCycle(cycle, settings) : 0
  }

  const currentMonthEntries = Object.entries(mainByCycle).filter(([key]) => key.startsWith(monthKey))
  return {
    ...totals,
    normalSecondsByCycle,
    mainByCycle: Object.fromEntries(currentMonthEntries),
    main: currentMonthEntries.reduce((total, [, amount]) => total + amount, 0),
    dailyMain: mainByCycle[currentCycleKey] || 0,
  }
}

export function monthToDateThroughYesterday(totals: Totals, currentCycleKey: string, currentMonthKey: string) {
  return Object.entries(totals.mainByCycle || {}).reduce((sum, [key, value]) => key.startsWith(currentMonthKey) && key < currentCycleKey ? sum + value : sum, 0)
}

function settleRunningLeave(next: PersistedState, toMs: number) {
  if (!next.runtime.leaveRunning) return
  const from = next.runtime.leaveProcessedAt || toMs
  const amount = Object.entries(normalWorkAmountsByCycle(from, toMs, next.settings)).reduce((sum, [, value]) => sum + value, 0)
  next.totals.leave += amount
  next.runtime.leaveProcessedAt = toMs
}

function settleRunningOvertime(next: PersistedState, toMs: number) {
  if (!next.runtime.overtimeRunning) return
  const from = next.runtime.overtimeProcessedAt || toMs
  next.totals.overtime -= overtimeAmountForRange(from, toMs, next.runtime.workdayOvertimeRate)
  next.runtime.overtimeProcessedAt = toMs
}

function settlePreWorkOvertime(next: PersistedState, toMs: number) {
  if (!next.runtime.preWorkOvertimeRunning) return
  const from = next.runtime.preWorkOvertimeProcessedAt || next.runtime.preWorkOvertimeStartedAt || toMs
  next.totals.overtime -= overtimeAmountForRange(from, toMs, next.runtime.preWorkOvertimeRate)
  next.runtime.preWorkOvertimeProcessedAt = toMs
}

function clearPreWorkOvertime(runtime: RuntimeState) {
  runtime.preWorkOvertimeRunning = false
  runtime.preWorkOvertimeCycleKey = ''
  runtime.preWorkOvertimeStartedAt = 0
  runtime.preWorkOvertimeProcessedAt = 0
  runtime.preWorkOvertimeRate = 0
}

function clearWorkdaySession(runtime: RuntimeState) {
  runtime.workdayStatus = 'working'
  runtime.workdayEndCycleKey = ''
  runtime.workdayEndAt = 0
  runtime.workdayOvertimeRate = 0
  runtime.overtimeSegmentStartedAt = 0
  runtime.overtimePausedAt = 0
  runtime.decisionCycle = ''
  runtime.decision = ''
  runtime.overtimeRunning = false
  runtime.overtimeMode = 'none'
}

export function advanceState(state: PersistedState, nowMs: number, boot = false) {
  const now = new Date(nowMs)
  const currentCycle = cycleDate(now)
  const currentCycleKey = formatDateKey(currentCycle)
  const currentMonthKey = monthKeyFromDate(currentCycle)
  const cycleBoundaryMs = setClock(currentCycle, '06:00').getTime()
  const previousCycleKey = state.runtime.cycleKey || currentCycleKey
  const cycleChanged = previousCycleKey !== currentCycleKey
  const monthChanged = Boolean(state.totals.monthKey && state.totals.monthKey !== currentMonthKey)
  const next = structuredClone(state)
  next.totals.mainByCycle = { ...(next.totals.mainByCycle || {}) }
  next.totals.normalSecondsByCycle = { ...(next.totals.normalSecondsByCycle || {}) }
  let didChange = false

  if (!next.settings.initialized) {
    next.totals.monthKey = currentMonthKey
    next.runtime.cycleKey = currentCycleKey
    next.runtime.mainCycleKey = currentCycleKey
    next.runtime.mainProcessedAt = nowMs
    next.runtime.leaveProcessedAt = nowMs
    next.runtime.overtimeProcessedAt = nowMs
    next.runtime.preWorkOvertimeProcessedAt = nowMs
    next.runtime.lastRefreshKey = currentCycleKey
    next.runtime.preWorkOvertimeCycleKey = currentCycleKey
    next.runtime.overtimeCycleKey = currentCycleKey
    next.runtime.quoteCycleKey = next.runtime.quoteCycleKey || currentCycleKey
    return { state: next, didChange: true }
  }

  if (cycleChanged && !boot) {
    settleRunningLeave(next, cycleBoundaryMs)
    settleRunningOvertime(next, cycleBoundaryMs)
    settlePreWorkOvertime(next, cycleBoundaryMs)
  }

  const shift = getShiftForCycle(currentCycle, next.settings)
  const isPreWorkWindow = isWorkday(currentCycle, next.settings.holidayOverrides) && now.getTime() >= cycleBoundaryMs && now.getTime() < shift.start.getTime()

  if (monthChanged) {
    next.totals.monthKey = currentMonthKey
    next.totals.main = 0
    next.totals.dailyMain = 0
    next.totals.mainByCycle = {}
    next.totals.normalSecondsByCycle = {}
    didChange = true
  }

  const previousMainAt = state.runtime.mainProcessedAt || nowMs
  let mainFrom = previousMainAt
  if (boot && state.runtime.mainCycleKey !== currentCycleKey) mainFrom = getShiftForCycle(currentCycle, next.settings).start.getTime()
  if (monthChanged) mainFrom = Math.max(cycleBoundaryMs, getShiftForCycle(currentCycle, next.settings).start.getTime())

  for (const [key, seconds] of Object.entries(normalCoverageSecondsByCycle(mainFrom, nowMs, next.settings))) {
    next.totals.normalSecondsByCycle[key] = (next.totals.normalSecondsByCycle[key] || 0) + seconds
    didChange = true
  }
  next.totals = recomputeNormalTotals(next.totals, next.settings, currentMonthKey, currentCycleKey)
  next.runtime.mainProcessedAt = nowMs
  next.runtime.mainCycleKey = currentCycleKey

  if (cycleChanged) {
    next.totals.leave = 0
    next.totals.overtime = 0
    next.runtime.lastRefreshKey = currentCycleKey
    next.runtime.dismissedNonworkdayCycle = ''
    next.runtime.leaveRunning = false
    next.runtime.leaveProcessedAt = nowMs
    next.runtime.overtimeProcessedAt = nowMs
    next.runtime.preWorkOvertimeProcessedAt = nowMs
    next.runtime.overtimeCycleKey = currentCycleKey
    clearPreWorkOvertime(next.runtime)
    next.runtime.preWorkOvertimeDeclined = false
    clearWorkdaySession(next.runtime)
    didChange = true
  } else {
    if (next.runtime.leaveRunning && !boot) settleRunningLeave(next, nowMs)
    if (next.runtime.overtimeRunning && !boot) settleRunningOvertime(next, nowMs)
    if (next.runtime.preWorkOvertimeRunning) {
      if (boot) {
        if (nowMs >= shift.start.getTime()) clearPreWorkOvertime(next.runtime)
        else next.runtime.preWorkOvertimeProcessedAt = nowMs
      } else if (nowMs >= shift.start.getTime()) {
        settlePreWorkOvertime(next, shift.start.getTime())
        clearPreWorkOvertime(next.runtime)
      } else {
        settlePreWorkOvertime(next, nowMs)
      }
    }
    next.runtime.leaveProcessedAt = nowMs
    next.runtime.overtimeProcessedAt = nowMs
  }

  if (isPreWorkWindow && next.runtime.preWorkOvertimeRunning && nowMs < shift.start.getTime()) {
    next.runtime.preWorkOvertimeCycleKey = currentCycleKey
  }

  const ended = pendingEndCycle(now, next.settings)
  const endedInCurrentBusinessContext = Boolean(ended && (formatDateKey(ended.cycle) === currentCycleKey || ended.shift.end.getTime() >= cycleBoundaryMs))
  if (
    ended &&
    endedInCurrentBusinessContext &&
    isWorkday(ended.cycle, next.settings.holidayOverrides) &&
    next.runtime.workdayStatus === 'working'
  ) {
    next.runtime.workdayStatus = 'awaiting-decision'
    next.runtime.workdayEndCycleKey = formatDateKey(ended.cycle)
    next.runtime.workdayEndAt = ended.shift.end.getTime()
    next.runtime.workdayOvertimeRate = rateForCycle(ended.cycle, next.settings)
    next.runtime.decisionCycle = formatDateKey(ended.cycle)
    next.runtime.decision = ''
    next.runtime.leaveRunning = false
    didChange = true
  }

  next.runtime.cycleKey = currentCycleKey
  return { state: next, didChange }
}
