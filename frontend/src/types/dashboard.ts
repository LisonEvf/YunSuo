export interface DashboardMeta {
  day: string
  updatedAt: string
  source: string
  warnings: string[]
}

export interface OverviewAdvice {
  aggressive: string
  steady: string
  min: number
  max: number
}

export interface OverviewStyle {
  text: string
  ok: boolean
}

export interface DashboardOverview {
  cycle: string
  sentiment: number
  advice: OverviewAdvice
  style: OverviewStyle[]
  timePlan: Array<{ time: string; text: string }>
}

export interface DashboardKpis {
  sentiment: number
  sentimentDelta: number
  limitUp: number
  broken: number
  limitDown: number
  sealRate: number
  bombRate: number
  yesterdayPremium: number
  linkBoardPremium: number
  upCount: number
  downCount: number
  marketAmount: number
  marketAmountText: string
  marketVsShort: number
  review: string
  bombRate5d: number
  firstBoardCount: number
  linkBoardCount: number
  marketAmountDelta: number
  nonBoardTemp: number
  openPremium: string
  marketCoef: number // 大盘系数（后端预计算）
  zhangfuDistribution: Array<{ range: string; count: number }> // 涨跌幅分档分布
}

export interface IndexItem {
  name: string
  code: string
  close: number
  diff: number
  pct: number
  up_count?: number
  down_count?: number
}

export interface TrendPlate {
  name: string
  strength: number
}

export interface TrendPoint {
  date: string
  score: number
  limit_up: number
  limit_down: number
  amount: number
  seal_rate: number
  bomb_rate: number
  plates: TrendPlate[]
  cycle: string
  marketCoef: number // 大盘系数线（后端预计算）
  shortSentiment: number // 超短情绪线
  moneyLoss: number // 亏钱效应线
}

export interface PlateItem {
  name: string
  pct: number
  code: string
  leader: string
  leaderCode: string
  leaderPct: number
  limitUps: number
  firstBoards: number
  maxBoard: number
  strength: number
  role: string
  stage: string
  capital: string
  sharePct: number
  middleStock: string
  middleCode: string
  linkBoardCount: number // 板块内连板股数
}

export interface MethodItem {
  name: string
  score: number
  status: string
  note: string
}

export interface RiskItem {
  title: string
  level: string
  text: string
}

export interface OpportunityItem {
  title: string
  grade: string
  text: string
  trigger: string
}

export interface WatchItem {
  name: string
  code: string
  theme: string
  condition: string
  priority: string
}

export interface MonitorItem {
  time: string
  code: string
  name: string
  desc: string
  value: number | string
}

export interface DashboardData {
  meta: DashboardMeta
  overview: DashboardOverview
  kpis: DashboardKpis
  indexes: IndexItem[]
  trend: TrendPoint[]
  plates: PlateItem[]
  methods: MethodItem[]
  risks: RiskItem[]
  opportunities: OpportunityItem[]
  watchlist: WatchItem[]
  monitor: MonitorItem[]
}
