interface PersistedState {
  version: number
  settings: AppSettings
  totals: Totals
  runtime: RuntimeState
  window: WindowState
}

interface QuoteRecord {
  id: string
  text: string
  createdAt: number
}

interface AppSettings {
  initialized: boolean
  monthlySalary: number
  startTime: string
  endTime: string
  theme: ThemeId
  moneyAnimation: boolean
  quotePool: QuoteRecord[]
  autoLaunch: boolean
  holidayOverrides: Record<string, boolean>
  pageDayOverrides: Record<string, boolean>
}

interface Totals {
  monthKey: string
  main: number
  dailyMain: number
  mainByCycle: Record<string, number>
  normalSecondsByCycle: Record<string, number>
  leave: number
  overtime: number
}

interface RuntimeState {
  leaveRunning: boolean
  overtimeRunning: boolean
  overtimeMode: 'none' | 'workday' | 'nonworkday'
  workdayStatus: 'working' | 'awaiting-decision' | 'sleeping' | 'overtime-running' | 'overtime-paused'
  workdayEndCycleKey: string
  workdayEndAt: number
  workdayOvertimeRate: number
  overtimeSegmentStartedAt: number
  overtimePausedAt: number
  preWorkOvertimeRunning: boolean
  preWorkOvertimeDeclined: boolean
  preWorkOvertimeCycleKey: string
  preWorkOvertimeStartedAt: number
  preWorkOvertimeProcessedAt: number
  preWorkOvertimeRate: number
  overtimeCycleKey: string
  dismissedNonworkdayCycle: string
  decisionCycle: string
  decision: '' | 'off' | 'overtime'
  cycleKey: string
  mainCycleKey: string
  mainProcessedAt: number
  leaveProcessedAt: number
  overtimeProcessedAt: number
  lastRefreshKey: string
  dailyQuote: string
  dailyQuoteId: string
  quoteCycleKey: string
}

interface WindowState {
  x: number | null
  y: number | null
  width: number
  height: number
  adjustable: boolean
}

type ThemeId = 'charcoal' | 'beige' | 'warm' | 'minimal' | 'coffee' | 'nature' | 'nordic' | 'purple' | 'cyan' | 'starry'

interface WindowNoteApi {
  loadState: () => Promise<PersistedState>
  saveState: (state: PersistedState) => Promise<PersistedState>
  setAdjustable: (adjustable: boolean) => Promise<void>
  closeApp: () => Promise<void>
  setAutoLaunch: (enabled: boolean) => Promise<void>
  onPowerState: (callback: (state: 'suspend' | 'resume') => void) => () => void
  onWindowState: (callback: (state: WindowState) => void) => () => void
}

interface Window {
  note: WindowNoteApi
}

declare module '*.png' {
  const source: string
  export default source
}

