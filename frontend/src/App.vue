<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import SparkLine from './components/SparkLine.vue'
import { fetchDashboard } from './services/api'
import type { DashboardData, PlateItem } from './types/dashboard'

type ThemeMode = 'auto' | 'light' | 'dark'

const loading = ref(true)
const error = ref('')
const dashboard = ref<DashboardData | null>(null)
const activeView = ref<'sentiment' | 'strategy'>('sentiment')
const themeMode = ref<ThemeMode>('auto')

const cycleSteps = ['退潮', '冰点', '常态', '启动', '发酵', '高潮']
const themeOptions: Array<{ value: ThemeMode; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]

onMounted(() => {
  restoreTheme()
  loadDashboard()
})

async function loadDashboard() {
  loading.value = true
  error.value = ''
  try {
    dashboard.value = await fetchDashboard()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '数据加载失败'
  } finally {
    loading.value = false
  }
}

const sentimentValues = computed(() => dashboard.value?.trend.map((item) => item.score) ?? [])
const limitUpValues = computed(() => dashboard.value?.trend.map((item) => item.limit_up) ?? [])
const limitDownValues = computed(() => dashboard.value?.trend.map((item) => item.limit_down) ?? [])
const amountValues = computed(() => dashboard.value?.trend.map((item) => item.amount) ?? [])

const leadPlates = computed(() => dashboard.value?.plates.slice(0, 8) ?? [])
const primaryPlates = computed(() => leadPlates.value.filter((item) => item.role === '主线').slice(0, 4))
const supportPlates = computed(() => leadPlates.value.filter((item) => item.role !== '主线').slice(0, 4))
const visiblePlates = computed(() => [...primaryPlates.value, ...supportPlates.value].slice(0, 7))

const topStrength = computed(() => Math.max(...leadPlates.value.map((item) => item.strength), 1))

function formatNumber(value: number, digits = 1) {
  return Number(value || 0).toLocaleString('zh-CN', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })
}

function formatPct(value: number) {
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${formatNumber(value, 2)}%`
}

function formatDate(value?: string) {
  if (!value) return '--'
  return value.replaceAll('-', '/')
}

function strengthWidth(item: PlateItem) {
  return `${Math.max(12, Math.min(100, (item.strength / topStrength.value) * 100))}%`
}

function priorityClass(priority: string) {
  if (priority.startsWith('A')) return 'red'
  if (priority.startsWith('B')) return 'yellow'
  if (priority.startsWith('C')) return 'blue'
  return ''
}

function restoreTheme() {
  const saved = window.localStorage.getItem('sentiment-theme')
  const mode: ThemeMode = saved === 'light' || saved === 'dark' || saved === 'auto' ? saved : 'auto'
  applyTheme(mode)
}

function applyTheme(mode: ThemeMode) {
  themeMode.value = mode
  document.documentElement.dataset.theme = mode
  document.documentElement.style.colorScheme = mode === 'auto' ? 'light dark' : mode
  window.localStorage.setItem('sentiment-theme', mode)
}
</script>

<template>
  <main class="page">
    <header class="app-nav">
      <div>
        <span class="source-pill">openkpl + opentdx</span>
        <h1>市场情绪策略看板</h1>
      </div>
      <div class="app-actions">
        <div class="view-switch" aria-label="视图切换">
          <button :class="{ active: activeView === 'sentiment' }" @click="activeView = 'sentiment'">情绪仪表盘</button>
          <button :class="{ active: activeView === 'strategy' }" @click="activeView = 'strategy'">明日策略</button>
        </div>
        <div class="theme-switch" aria-label="主题模式">
          <button
            v-for="option in themeOptions"
            :key="option.value"
            :class="{ active: themeMode === option.value }"
            :aria-pressed="themeMode === option.value"
            @click="applyTheme(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
    </header>

    <section v-if="loading" class="card loading-state">正在接入行情与情绪数据...</section>
    <section v-else-if="error" class="card error-state">
      <b>数据加载失败</b>
      <span>{{ error }}</span>
      <button @click="loadDashboard">重试</button>
    </section>

    <template v-else-if="dashboard">
      <section class="card overview">
        <div class="overview-top">
          <span>数据日期：{{ formatDate(dashboard.meta.day) }}</span>
          <span>数据最后更新时间：{{ dashboard.meta.updatedAt || '--' }}</span>
        </div>
        <div class="overview-grid">
          <div>
            <div class="section-label">情绪周期节点 <span class="info">i</span></div>
            <div class="state">{{ dashboard.overview.cycle }} <span class="badge">{{ dashboard.overview.cycle }}</span></div>
            <div class="emotion-line">情绪综合指数 <b>{{ formatNumber(dashboard.overview.sentiment, 1) }}</b> <span class="info">i</span></div>
          </div>
          <div>
            <div class="section-label">明日仓位建议</div>
            <div class="advice-row"><span>激进型</span><b>{{ dashboard.overview.advice.aggressive }}</b></div>
            <div class="advice-row"><span>稳健型</span><strong>{{ dashboard.overview.advice.steady }}</strong></div>
            <div class="thin-progress"><span :style="{ width: `${dashboard.overview.advice.max}%` }"></span></div>
            <div class="hint">建议仓位：{{ dashboard.overview.advice.min }}% - {{ dashboard.overview.advice.max }}%</div>
          </div>
          <div>
            <div class="section-label">技术风格匹配</div>
            <div class="risk-list">
              <div v-for="item in dashboard.overview.style" :key="item.text" :class="{ ok: item.ok }">- {{ item.text }}</div>
            </div>
          </div>
          <div>
            <div class="section-label">关键时点预案</div>
            <div class="time-list">
              <div v-for="item in dashboard.overview.timePlan" :key="item.time"><span>{{ item.time }}</span><b>{{ item.text }}</b></div>
            </div>
          </div>
        </div>
      </section>

      <section v-if="activeView === 'sentiment'" class="sentiment-view">
        <section class="topbar">
          <div>
            <div class="version"><b>V3.0 PRO</b><span>数据更新于 <strong>{{ formatDate(dashboard.meta.day) }}</strong></span></div>
            <h2>市场情绪仪表盘</h2>
            <p class="subtitle">基于 openkpl 情绪复盘与 opentdx 行情数据的综合分析</p>
          </div>
          <div class="filters">
            <div class="datebox"><label>交易日</label><strong>{{ formatDate(dashboard.meta.day) }}</strong></div>
            <div class="range"><span>近5日</span><span>实时</span><span class="active">组合视图</span></div>
          </div>
        </section>

        <section class="grid-top">
          <article class="card metric-card">
            <div class="card-title"><span class="dot"></span>情绪综合指数 <span class="info">i</span><span class="tag">中性观望</span></div>
            <div class="note">综合市场情绪量化指标</div>
            <div class="gauge-row">
              <div class="gauge" :style="{ '--gauge': `${dashboard.kpis.sentiment}%` }"><div class="gauge-value">{{ Math.round(dashboard.kpis.sentiment) }}<small>指数</small></div></div>
              <div>
                <div class="scale-labels"><span>极度低迷</span><span>高潮</span></div>
                <div class="scale"></div>
                <div class="scale-labels"><span>强度 0</span><span class="pill">{{ formatPct(dashboard.kpis.sentimentDelta) }}</span></div>
              </div>
            </div>
          </article>

          <article class="card metric-card accent-blue">
            <div class="card-title">最新交易日 <span class="tag quiet">样本 {{ dashboard.trend.length }}</span></div>
            <div class="big-date">{{ formatDate(dashboard.meta.day) }}</div>
            <div class="note"><span class="blue-dot">●</span> 当前情绪日径归属日</div>
            <div class="mini-grid">
              <div class="mini-box">周期 <b>{{ dashboard.overview.cycle }}</b></div>
              <div class="mini-box">信号 <b>强度 {{ Math.round(dashboard.kpis.sentiment) }}</b></div>
              <div class="mini-box">口径 <b>实时口径</b></div>
              <div class="mini-box">策略 <b>{{ dashboard.overview.advice.steady }}</b></div>
            </div>
          </article>

          <article class="card metric-card accent-pink">
            <div class="card-title"><span class="hot-dot">●</span> 涨停 / 炸板 / 跌停 <span class="tag red-tag">{{ dashboard.kpis.limitUp - dashboard.kpis.limitDown }}</span></div>
            <div class="triple"><span class="red">{{ dashboard.kpis.limitUp }}</span> <span>/</span> <span class="orange">{{ dashboard.kpis.broken }}</span> <span>/</span> <span class="green">{{ dashboard.kpis.limitDown }}</span></div>
            <div class="link">详情</div>
            <div class="note">封板 / 炸板 / 跌停（情绪强弱与风险指标）</div>
            <div class="fact-grid">
              <span>封板率 <b>{{ formatPct(dashboard.kpis.sealRate) }}</b></span><span>净强度 <b>{{ dashboard.kpis.limitUp - dashboard.kpis.limitDown }}</b></span>
              <span>封跌比分级 <b>{{ dashboard.kpis.limitUp > dashboard.kpis.limitDown * 2 ? '偏强' : '承压' }}</b></span><span>昨日涨停溢价 <b>{{ formatPct(dashboard.kpis.yesterdayPremium) }}</b></span>
            </div>
          </article>

          <article class="card metric-card accent-orange">
            <div class="card-title"><span class="orange-dot">●</span> 炸板率 <span class="tag red-tag">{{ formatPct(-dashboard.kpis.bombRate / 3) }}</span></div>
            <div class="rate">{{ formatPct(dashboard.kpis.bombRate) }}</div>
            <div class="progress"><span :style="{ width: `${Math.min(dashboard.kpis.bombRate, 100)}%` }"></span></div>
            <div class="scale-labels metric-foot"><span>封板率</span><strong>{{ formatPct(dashboard.kpis.sealRate) }}</strong></div>
            <div class="note warning-note">风险参考：{{ dashboard.methods.at(-1)?.status }}（昨日溢价 {{ formatPct(dashboard.kpis.yesterdayPremium) }}）</div>
          </article>
        </section>

        <section class="stat-row">
          <article class="card stat"><div class="label">大盘系数 <span class="info">i</span></div><div class="num pink">{{ formatNumber(50 + dashboard.indexes.reduce((sum, item) => sum + item.pct, 0), 1) }}</div><div class="sub">指数环境</div></article>
          <article class="card stat"><div class="label">超短情绪 <span class="info">i</span></div><div class="num purple">{{ formatNumber(dashboard.kpis.sentiment, 1) }}</div><div class="sub">短线接力温度</div></article>
          <article class="card stat"><div class="label">亏钱效应 <span class="info">i</span></div><div class="num green-text">{{ formatNumber(100 - dashboard.kpis.bombRate, 1) }}</div><div class="sub">风险压力指标</div></article>
          <article class="card stat"><div class="label">三线分歧度</div><div class="num">{{ formatNumber(Math.abs(dashboard.kpis.marketVsShort), 1) }}</div><div class="sub">分化强度</div></article>
          <article class="card stat"><div class="label">大盘VS超短</div><div class="num">{{ formatNumber(dashboard.kpis.marketVsShort, 1) }}</div><div class="sub">差值状态</div></article>
          <article class="card stat"><div class="label pink">交易建议</div><div class="num text-num">{{ dashboard.overview.advice.steady }}</div><div class="sub pink">系统执行建议</div></article>
        </section>

        <section class="main-grid">
          <section>
            <article class="card panel">
              <div class="panel-title"><span class="blue-dot">✦</span> 情绪周期三线监控 <span class="info">i</span></div>
              <div class="note">大盘系数 · 超短情绪 · 亏钱效应 · 综合指数</div>
              <div class="legend"><span class="hot-dot">● 高潮区 80-100</span><span class="blue-dot">● 冰点区 0-20</span><span class="tag quiet">历史样本 {{ dashboard.trend.length }} 日</span></div>
              <div class="chart-wrap">
                <SparkLine :values="sentimentValues" color="#ef2c67" fill="rgba(239,44,103,.13)" :height="360" />
              </div>
              <div class="summary-cells">
                <div>最新节点 <span class="info">i</span><b>{{ dashboard.overview.cycle }}</b>情绪标签</div>
                <div>三线分歧<b class="orange">{{ formatNumber(dashboard.kpis.marketVsShort, 1) }}</b>标准差</div>
                <div>大盘宽度<b>{{ dashboard.kpis.upCount }} / {{ dashboard.kpis.downCount }}</b>涨跌家数</div>
                <div>综合指数<b class="blue-dot">{{ formatNumber(dashboard.kpis.sentiment, 1) }}</b>情绪读数</div>
              </div>
              <div class="two-box">
                <div class="plain-box"><h3>短线执行看板</h3><p>5日情绪变化 <b>{{ formatPct(dashboard.kpis.sentimentDelta) }}</b>　炸板率 <b>{{ formatPct(dashboard.kpis.bombRate) }}</b></p><p>背离状态 <b>{{ dashboard.kpis.marketVsShort > 15 ? '轻度背离' : '同步正常' }}</b>　跌停家数 <b>{{ dashboard.kpis.limitDown }}</b></p></div>
                <div class="plain-box"><h3>今日操作框架</h3><p>{{ dashboard.kpis.review || '控制仓位，优先主线分歧后的转强。' }}</p><p><span class="tag quiet">风险中</span> <span class="tag">{{ dashboard.overview.advice.aggressive }}</span> <span class="pill">收盘溢价 {{ formatPct(dashboard.kpis.yesterdayPremium) }}</span></p></div>
              </div>
            </article>
          </section>

          <aside>
            <article class="card panel warn">
              <div class="panel-title"><span class="hot-dot">▲</span> 风险提示</div>
              <p v-for="risk in dashboard.risks.slice(0, 2)" :key="risk.title" class="note risk-note">· {{ risk.title }}：{{ risk.text }}</p>
            </article>
            <article class="card small-kpi">
              <div><span>涨停家数</span><b class="pink">{{ dashboard.kpis.limitUp }}</b></div>
              <div><span>炸板家数</span><b class="orange">{{ dashboard.kpis.broken }}</b></div>
              <div><span>跌停家数</span><b class="green-text">{{ dashboard.kpis.limitDown }}</b></div>
              <div><span>综合指数</span><b class="blue-dot">{{ formatNumber(dashboard.kpis.sentiment, 1) }}</b></div>
              <div><span>上涨家数</span><b class="green-text">{{ dashboard.kpis.upCount }}</b></div>
              <div><span>封跌比</span><b>{{ formatNumber(dashboard.kpis.limitUp / Math.max(dashboard.kpis.limitDown, 1), 2) }}</b></div>
            </article>
            <article class="card rank-list">
              <div class="rank-title"><span>板块强度 TOP8</span><small>{{ formatDate(dashboard.meta.day) }}</small></div>
              <div v-for="(item, index) in leadPlates" :key="item.name" class="rank-item">
                <span>{{ index + 1 }}</span>
                <div>{{ item.name }}<div class="bar" :class="{ orange: item.role !== '主线' }"><span :style="{ width: strengthWidth(item) }"></span></div></div>
                <b :class="item.role === '主线' ? 'pink' : 'orange'">{{ item.stage }}</b>
              </div>
            </article>
          </aside>
        </section>

        <section class="card heat-panel">
          <div class="heat-head">
            <div>
              <div class="panel-title"><span class="orange">●</span> 板块情绪热力分布图</div>
              <div class="note">概念板块强度 | 强度越高颜色越热</div>
            </div>
            <div><span class="pink">■ 涨停潮</span>　<span class="orange">■ 活跃</span>　<span class="green-text">■ 调整</span> <span class="toggle"><b>热→冷</b><span>冷→热</span></span></div>
          </div>
          <div class="heatmap dynamic-heatmap">
            <template v-for="item in leadPlates" :key="item.name">
              <div class="rowlabel">{{ item.name }}</div>
              <div v-for="point in dashboard.trend" :key="`${item.name}-${point.date}`" :class="['heat-cell', item.strength > topStrength * 0.7 ? 'h4' : item.strength > topStrength * 0.45 ? 'h3' : item.strength > topStrength * 0.25 ? 'h2' : 'h1']">
                {{ Math.round(item.strength * (0.72 + point.score / 350)) }}
              </div>
            </template>
          </div>
        </section>
      </section>

      <section v-else class="strategy-view">
        <section class="card panel">
          <div class="panel-title">核心指数监控</div>
          <div class="index-grid">
            <article v-for="item in dashboard.indexes" :key="item.code" class="index-card">
              <div class="index-head"><span>{{ item.name }}</span><span>{{ item.code }}</span></div>
              <div class="index-number" :class="{ red: item.pct > 0 }">{{ formatNumber(item.close, 2) }}</div>
              <div class="index-foot"><span :class="{ up: item.pct > 0 }">{{ formatPct(item.pct) }}</span><span>{{ formatNumber(item.diff, 2) }}</span></div>
            </article>
          </div>
          <div class="diagnose"><b>大盘诊断：{{ dashboard.indexes.some((item) => item.pct > 0) ? '震荡分化' : '整体承压' }}</b>　上涨：{{ dashboard.kpis.upCount }} / 下跌：{{ dashboard.kpis.downCount }}</div>
        </section>

        <section class="kpi-grid">
          <article class="card kpi"><h3>情绪综合指数</h3><b>{{ formatNumber(dashboard.kpis.sentiment, 1) }}</b><p>较昨日 {{ formatPct(dashboard.kpis.sentimentDelta) }}</p></article>
          <article class="card kpi"><h3>炸板率</h3><b>{{ formatPct(dashboard.kpis.bombRate) }}</b><p class="pink">炸板家数：{{ dashboard.kpis.broken }}</p></article>
          <article class="card kpi"><h3>昨日涨停溢价</h3><b>{{ formatPct(dashboard.kpis.yesterdayPremium) }}</b><p>连板溢价 {{ formatPct(dashboard.kpis.linkBoardPremium) }}</p></article>
          <article class="card kpi"><h3>连板空间高度</h3><b>{{ Math.max(...leadPlates.map((item) => item.maxBoard), 0) }}</b><p class="orange">{{ leadPlates[0]?.leader || '等待确认' }} | 风险累积</p></article>
        </section>

        <section class="body-grid">
          <aside class="card left-panel">
            <div class="panel-title">情绪周期定位</div>
            <div class="stepper">
              <div v-for="step in cycleSteps" :key="step" class="step" :class="{ active: step === dashboard.overview.cycle }">{{ step }}</div>
            </div>
            <div class="data-row"><span>大盘VS超短</span><b>{{ formatNumber(dashboard.kpis.marketVsShort, 1) }} <span>{{ dashboard.kpis.marketVsShort > 15 ? '轻度背离' : '同步正常' }}</span></b></div>
            <div class="data-row"><span>市场温度</span><b>{{ Math.round(dashboard.kpis.sentiment) }}/100 <span>{{ dashboard.overview.cycle }}</span></b></div>
            <div class="data-row"><span>涨跌停家数</span><b>涨停{{ dashboard.kpis.limitUp }} / 跌停{{ dashboard.kpis.limitDown }}</b></div>
            <div class="data-row"><span>两市成交额</span><b>{{ formatNumber(dashboard.kpis.marketAmount, 1) }}亿</b></div>

            <div class="mini-chart">
              <div class="mini-chart-head"><b>近5日情绪评分走势</b><span>区间：0-100</span></div>
              <SparkLine :values="sentimentValues" />
            </div>
            <div class="mini-chart">
              <div class="mini-chart-head"><b>近5日涨跌停家数</b><span><i class="pink">●</i> 涨停　<i class="green-text">●</i> 跌停</span></div>
              <SparkLine :values="limitUpValues" color="#ef2c67" fill="rgba(239,44,103,.12)" />
              <SparkLine :values="limitDownValues" color="#19a76a" fill="rgba(25,167,106,.10)" :height="120" />
            </div>
            <div class="mini-chart">
              <div class="mini-chart-head"><b>近5日两市成交额趋势（亿）</b><span>最新：{{ formatNumber(dashboard.kpis.marketAmount, 1) }}</span></div>
              <SparkLine :values="amountValues" color="#3d7eff" fill="rgba(61,126,255,.12)" />
            </div>

            <div class="conclusion"><b>周期结论</b><br>周期结构处于{{ dashboard.overview.cycle }}，结合主线强度、晋级率和亏钱效应决定仓位。</div>
          </aside>

          <section class="card right-panel">
            <div class="panel-title">板块梯队复盘</div>
            <div class="tabs"><span class="badge red">主线</span><span class="badge yellow">支线</span><span class="badge blue">轮动</span></div>
            <article v-for="item in visiblePlates" :key="item.name" class="ladder-card" :class="item.role === '主线' ? 'main' : 'support'">
              <div>
                <div class="ladder-title">{{ item.name }} <span class="badge" :class="item.role === '主线' ? 'red' : 'yellow'">{{ item.role }}</span> <span>{{ item.stage }}</span></div>
                <div class="ladder-meta">
                  <span>最高板：{{ item.maxBoard }}</span><span>3板+：{{ item.maxBoard >= 3 ? 1 : 0 }}</span><span>2板：{{ item.maxBoard === 2 ? 1 : 0 }}</span><span>首板：{{ item.firstBoards }}</span>
                  <span>龙头：{{ item.leader || '待确认' }}</span><span>中军：{{ item.leader || '待确认' }}</span><span>资金：{{ item.capital }}</span><span>涨幅：{{ formatPct(item.pct) }}</span>
                  <span class="wide">策略：主线前排优先，后排仅在分歧转一致时跟随。</span><span class="wide">风险：关注次日竞价强弱与回封效率。</span>
                </div>
              </div>
              <div><div class="strength" :class="{ red: item.role === '主线' }">强度:{{ formatNumber(item.strength, 1) }}</div><div class="small-bar"><span :style="{ width: strengthWidth(item) }"></span></div></div>
            </article>
          </section>
        </section>

        <section class="card panel">
          <div class="panel-title">赚钱手法分析</div>
          <div class="method-grid">
            <article v-for="item in dashboard.methods" :key="item.name" class="method"><h3>{{ item.name }} <span>{{ item.status }}</span></h3><b>{{ formatPct(item.score) }}</b><p>{{ item.note }}</p></article>
          </div>
        </section>

        <section class="bottom-grid">
          <article class="card risk-box">
            <div class="panel-title"><span class="pink">▲</span> 明日风险 Checklist</div>
            <div v-for="risk in dashboard.risks" :key="risk.title" class="alert"><b>{{ risk.title }}</b><span class="level">{{ risk.level }}</span>{{ risk.text }}</div>
          </article>
          <article class="card watch-box">
            <div class="panel-title"><span class="green-text">▣</span> 明日机会 Watchlist</div>
            <div v-for="item in dashboard.opportunities" :key="item.title" class="opportunity"><b>{{ item.title }} <span class="badge green">{{ item.grade }}</span></b>{{ item.text }}<br>触发条件：{{ item.trigger }}</div>
          </article>
        </section>

        <section class="card pool">
          <div class="pool-head">
            <div class="panel-title">明日观察池</div>
            <div class="class-tags"><span class="badge red">A类：必争之地</span><span class="badge yellow">B类：条件触发</span><span class="badge blue">C类：备选观察</span></div>
          </div>
          <table class="table">
            <thead><tr><th>标的</th><th>题材</th><th>买点条件</th><th>优先级</th></tr></thead>
            <tbody>
              <tr v-for="item in dashboard.watchlist" :key="item.code">
                <td><b>{{ item.name }}</b><span class="code">{{ item.code }}</span></td><td>{{ item.theme }}</td><td><b>{{ item.condition }}</b></td><td><span class="badge" :class="priorityClass(item.priority)">{{ item.priority }}</span></td>
              </tr>
            </tbody>
          </table>
          <div class="tip"><b>提示</b><br>所有买点需配合大盘不暴跌且跌停家数不继续扩散。不满足条件则放弃。<br><br>数据质量：{{ dashboard.meta.warnings.length ? 'partial' : 'ok' }}</div>
        </section>
      </section>

      <section v-if="dashboard.meta.warnings.length" class="card warning-panel">
        <b>数据源提示</b>
        <span v-for="item in dashboard.meta.warnings.slice(0, 4)" :key="item">{{ item }}</span>
      </section>
    </template>
  </main>
</template>
