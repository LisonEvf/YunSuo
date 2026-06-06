# 市场情绪策略看板 — 数据需求文档

> 基于 `template/sentiment.html`（情绪仪表盘）和 `template/AAR.html`（明日策略看板）两个页面的逐组件分析。
>
> 生成日期：2026/06/03
>
> 当前说明：本文是数据字段和旧模板需求资料。AIRUI 分支的实际前端已经改为
> React + AIRUI SPA，不再直接使用 `sentiment-view` / `strategy-view` 两个旧视图。
> 数据源和 `/api/dashboard` 字段需求仍可作为后端聚合口径参考。

---

## 一、页面总览

| 页面 | 模板文件 | 前端视图 | 职责 |
|------|----------|----------|------|
| 市场情绪仪表盘 | `sentiment.html` | `sentiment-view` | 实时市场情绪量化总览，三线趋势监控，板块热力分布 |
| 明日策略看板 | `AAR.html` | `strategy-view` | 次日仓位/板块/手法/风险/机会的操盘策略输出 |

两个页面共享同一套 API 响应（`/api/dashboard`），由 `DashboardData` 统一承载。

---

## 二、数据源依赖

| 数据源 | SDK | 用途 |
|--------|-----|------|
| 开盘啦 | `kpl_sdk.client.KplClient` | 情绪指数、涨跌停、炸板、板块强度、打板列表 |
| 通达信 | `opentdx.tdxClient.TdxClient` | 核心指数行情、市场监控、K线、报价 |

后端 `DataService` 通过 45 秒 TTL 缓存聚合两个数据源，一次请求返回全部数据。

---

## 三、API 响应结构（现有）

```
GET /api/dashboard?day=YYYY-MM-DD（可选）
```

返回 `DashboardData`，顶层字段：

```typescript
{
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
```

---

## 四、情绪仪表盘 — 逐组件数据需求

### 4.1 顶栏 (Topbar)

**UI 元素：**
- 版本号 `V3.0 PRO`
- 数据更新日期
- 交易日选择器
- 时间范围切换（近14日 / 近30日 / 近60日）

**数据字段：**

| 字段 | 来源 | 说明 |
|------|------|------|
| `meta.day` | `KplClient.emotion.today.day` | 当前交易日 |
| `meta.updatedAt` | `emotion.ts` 或 `market_status.time` | 数据更新时间戳 |

**需求：** 时间范围切换当前前端仅做展示，未传参后端。建议后端 `trend` 返回由前端按时间窗口截取，或增加 `range` 查询参数。

---

### 4.2 情绪综合指数卡片

**UI 元素：**
- 仪表盘圆环（当前值 / 100）
- 指数数值
- 情绪标签（如"中性观望"）
- 强度变化值（如 `+16.6`）
- 渐变标尺（极度低迷 → 高潮）

**数据字段：**

| 字段 | 来源 | 说明 |
|------|------|------|
| `kpis.sentiment` | 综合计算（封板率×0.35 + 涨停/120×35 + 广度×0.2 - 跌停/80×20） | 0-100 情绪分数 |
| `kpis.sentimentDelta` | `trend[-1].score - trend[-2].score` | 较前日变化 |
| `overview.cycle` | 由 `_cycle_label()` 根据情绪/跌停/炸板率判定 | 退潮/冰点/常态/启动/发酵/高潮 |

**计算逻辑摘要：**
- sentiment < 20 或 limitDown ≥ 50 → **冰点**
- sentiment < 35 或 bombRate ≥ 45 → **退潮**
- sentiment < 55 → **常态**
- sentiment < 70 → **启动**
- sentiment < 85 → **发酵**
- sentiment ≥ 85 → **高潮**

---

### 4.3 最新交易日卡片

**UI 元素：**
- 当前日期
- 样本数（trend 天数）
- 四宫格：周期 / 信号强度 / 口径 / 策略

**数据字段：**

| 字段 | 来源 |
|------|------|
| `meta.day` | 交易日 |
| `trend.length` | 样本天数 |
| `overview.cycle` | 周期标签 |
| `kpis.sentiment` | 信号强度 |
| `overview.advice.steady` | 策略建议 |

---

### 4.4 涨停/炸板/跌停卡片

**UI 元素：**
- 三大数字：涨停数 / 炸板数 / 跌停数
- 差值标签
- 封板率、净强度、封跌比分级、昨日涨停溢价

**数据字段：**

| 字段 | 来源 | 说明 |
|------|------|------|
| `kpis.limitUp` | `zhangting.zt_count` / `daban.t_zhangting` / `daily_nums.zt` | 涨停家数 |
| `kpis.broken` | `sharp.num` / `daily_nums.pb` | 炸板家数 |
| `kpis.limitDown` | `zhangting.dt_count` / `daban.t_dieting` / `daily_nums.dt` | 跌停家数 |
| `kpis.sealRate` | `daban.t_fengban` / `zhangting.feng_ban_lv` | 封板率 |
| `kpis.yesterdayPremium` | `daban.zr_ztj` / `zhangting.zt_avg_pct` | 昨日涨停溢价 |
| 净强度 | `limitUp - limitDown` | 前端计算 |
| 封跌比分级 | `limitUp > limitDown * 2 ? '偏强' : '承压'` | 前端计算 |

---

### 4.5 炸板率卡片

**UI 元素：**
- 炸板率百分比（大号）
- 进度条
- 封板率
- 风险参考文本

**数据字段：**

| 字段 | 来源 | 说明 |
|------|------|------|
| `kpis.bombRate` | `100 - sealRate` | 炸板率 |
| `kpis.sealRate` | 同上 | 封板率 |
| `methods[-1].status` | 空仓观望建议状态 | 风险参考 |
| `kpis.yesterdayPremium` | 同上 | 昨日溢价 |

---

### 4.6 六指标行 (Stat Row)

**UI 元素：** 6 个 stat 卡片横排

| 卡片 | 数据字段 | 计算方式 |
|------|----------|----------|
| 大盘系数 | 前端计算 | `50 + Σindexes[].pct` |
| 超短情绪 | `kpis.sentiment` | 直接取值 |
| 亏钱效应 | 前端计算 | `100 - bombRate` |
| 三线分歧度 | `kpis.marketVsShort` | `abs(ΣindexPct×10 - sentiment/10)` |
| 大盘VS超短 | `kpis.marketVsShort` | 同上（带正负号） |
| 交易建议 | `overview.advice.steady` | 直接取值 |

各卡片 delta 值由前端对比 `trend[-1]` 和 `trend[-2]` 计算。

---

### 4.7 情绪周期三线监控图

**UI 元素：**
- 三条折线（大盘系数 / 超短情绪 / 亏钱效应）
- 高潮区/冰点区背景色带
- 冰点信号三角标记
- 冰点信号次数
- 底部四个汇总单元格
- 短线执行看板 + 今日操作框架

**数据字段：**

| 字段 | 来源 | 说明 |
|------|------|------|
| `trend[]` | 历史多日数据 | 时间序列 |
| `trend[].score` | 每日情绪分数 | 折线Y值 |
| `trend[].date` | 日期 | X轴标签 |
| `trend[].limit_up` | 每日涨停数 | 辅助计算 |
| `trend[].limit_down` | 每日跌停数 | 辅助计算 |
| `trend[].plates[]` | 每日板块强度 | 热力图用 |
| `trend[].cycle` | 每日周期标签 | date-grid 用 |
| `trend[].amount` | 每日成交额 | 辅助 |

**前端三线计算逻辑：**
- 大盘系数 = `score×0.7 + (limitUp/(limitUp+limitDown))×30`
- 超短情绪 = `score×1.05`
- 亏钱效应 = `max(0, min(100, (1 - limitDown/max(limitUp,1))×100))`

冰点信号：`score < 20` 的数据点。

---

### 4.8 风险提示面板

**数据字段：**

| 字段 | 来源 |
|------|------|
| `risks[].title` | 风险标题 |
| `risks[].text` | 风险描述 |
| `risks[].level` | 高/中/低 |

后端 `_risks()` 自动生成：跌停扩散、炸板率偏高、情绪高潮、三线失衡等。

---

### 4.9 小 KPI 面板

6 个 KPI 网格，全部直接取 `kpis` 字段：
- 涨停家数 `kpis.limitUp`
- 炸板家数 `kpis.broken`
- 跌停家数 `kpis.limitDown`
- 综合指数 `kpis.sentiment`
- 冰点信号 `icePointIndices.length`（前端计算）
- 封跌比 `limitUp / max(limitDown, 1)`（前端计算）

---

### 4.10 板块强度 TOP8 排名

**数据字段：**

| 字段 | 来源 | 说明 |
|------|------|------|
| `plates[].name` | 板块名称 | |
| `plates[].strength` | 综合强度 | `abs(pct)×1000 + limitUps×850 + leaderPct×100` |
| `plates[].role` | 主线/支线 | strength≥3000 或 limitUps≥3 → 主线 |
| `plates[].stage` | 高潮/发酵/启动/轮动 | 由 maxBoard 和 limitUps 判定 |
| `plates[].pct` | 板块涨跌幅 | |
| `plates[].leader` | 龙头股名称 | |
| `plates[].leaderCode` | 龙头股代码 | |
| `plates[].leaderPct` | 龙头涨跌幅 | |
| `plates[].limitUps` | 涨停数 | |
| `plates[].maxBoard` | 最高连板数 | |
| `plates[].firstBoards` | 首板数 | |
| `plates[].capital` | 资金类型 | pct≥2→机构主导，否则混合博弈 |
| `plates[].code` | 板块代码 | |

**数据来源链路：**
- `kpl.history.weight_performance` → 主排名
- `kpl.history.weight_performance_list` → 补充
- `kpl.emotion.today.plates` → 再补充
- `kpl.history.daban_list` → 打板股匹配板块，补充 limitUps/maxBoard/leader

进度条宽度 = `strength / maxStrength × 100%`（前端计算）。

---

### 4.11 板块情绪热力分布图

**UI 元素：**
- 热力矩阵：行=板块名，列=日期
- 单元格颜色等级 h1-h5（按 strength 分档）
- 热力排序切换按钮
- 下方 date-grid：每日 TOP3 板块 + 周期状态

**数据字段：**

| 字段 | 来源 |
|------|------|
| `trend[].plates[].name` | 板块名（行标签） |
| `trend[].plates[].strength` | 热力值 |
| `trend[].date` | 日期（列标签） |
| `trend[].cycle` | 周期状态 |

**热力分档（前端）：**
- strength ≥ 6000 → h5（红色）
- strength ≥ 3500 → h4
- strength ≥ 2000 → h3
- strength ≥ 1000 → h2
- strength < 1000 → h1
- null → empty

行排序：取各板块在整个 trend 区间的 max strength 降序，取 TOP10。

---

## 五、明日策略看板 — 逐组件数据需求

### 5.1 总览面板 (Overview)

**UI 元素：** 四列布局

| 列 | 内容 | 数据字段 |
|----|------|----------|
| 情绪周期节点 | 周期名 + badge + 情绪指数 | `overview.cycle`, `overview.sentiment` |
| 明日仓位建议 | 激进/稳健 + 进度条 + 范围 | `overview.advice.{aggressive, steady, min, max}` |
| 技术风格匹配 | 3 条风格建议 | `overview.style[].{text, ok}` |
| 关键时点预案 | 时间点列表 | `overview.timePlan[].{time, text}` |

---

### 5.2 核心指数监控

**UI 元素：** 7 个指数卡片 + 大盘诊断

**数据字段：**

| 字段 | 来源 | 说明 |
|------|------|------|
| `indexes[].name` | `INDEX_SYMBOLS` 配置 | 指数名称 |
| `indexes[].code` | 同上 | 代码 |
| `indexes[].close` | `TdxClient.index_info` | 收盘价 |
| `indexes[].diff` | 计算 | 涨跌点数 |
| `indexes[].pct` | 计算 | 涨跌幅% |
| `indexes[].up_count` | 通达信 | 上涨家数 |
| `indexes[].down_count` | 通达信 | 下跌家数 |

大盘诊断文本由前端拼接：判断"震荡分化"或"整体承压" + 涨跌家数。

**7 个指数固定为：**
上证指数(000001.SH)、深证成指(399001.SZ)、创业板指(399006.SZ)、科创50(000688.SH)、上证50(000016.SH)、沪深300(000300.SH)、北证50(899050.BJ)。

---

### 5.3 四大 KPI 卡片

| 卡片 | 字段 | 说明 |
|------|------|------|
| 情绪综合指数 | `kpis.sentiment`, `kpis.sentimentDelta` | 较昨日变化 |
| 炸板率 | `kpis.bombRate`, `kpis.broken` | 炸板家数 |
| 昨日涨停溢价 | `kpis.yesterdayPremium`, `kpis.linkBoardPremium` | 收盘/连板溢价 |
| 连板空间高度 | `max(plates[].maxBoard)` | 最高板数 + 龙头名 |

---

### 5.4 情绪周期定位（左面板）

**UI 元素：**
- 6 步骤条（退潮→冰点→常态→启动→发酵→高潮），当前节点高亮
- 4 行数据指标
- 3 个迷你图表（5日情绪、5日涨跌停、5日成交额）
- 周期结论文本

**数据字段：**

| 指标 | 字段 | 说明 |
|------|------|------|
| 大盘VS超短 | `kpis.marketVsShort` | >15 显示"轻度背离" |
| 市场温度 | `kpis.sentiment` | xx/100 |
| 涨跌停家数 | `kpis.limitUp`, `kpis.limitDown` | 涨停x / 跌停x |
| 两市成交额 | `kpis.marketAmount` | 亿元 |

**迷你图表数据（前端从 trend 截取后5天）：**
- 情绪走势：`trend.slice(-5).map(t => t.score)`
- 涨跌停：`trend.slice(-5).map(t => t.limit_up)` + `trend.slice(-5).map(t => t.limit_down)`
- 成交额：`trend.slice(-5).map(t => t.amount)`

---

### 5.5 板块梯队复盘（右面板）

**UI 元素：**
- 主线/支线/轮动标签切换
- 梯队卡片列表（主线红底，支线金底）
- 每卡含：板块名、角色badge、阶段、8项元数据、强度值、进度条

**数据字段（全部来自 `plates[]`）：**

| 字段 | 展示位置 |
|------|----------|
| `name` | 卡片标题 |
| `role` (主线/支线) | badge 颜色 + 卡片底色 |
| `stage` (高潮/发酵/启动/轮动) | 标题旁文字 |
| `maxBoard` | 最高板 |
| `firstBoards` | 首板数 |
| `leader` | 龙头 |
| `capital` | 资金类型 |
| `strength` | 强度数值 + 进度条 |
| `pct` | 板块涨跌幅（隐藏但参与计算） |

前端将 plates 分为 primaryPlates(role=主线) 和 supportPlates(非主线)，合并取前7个展示。

---

### 5.6 赚钱手法分析

**UI 元素：** 4 格网格

| 手法 | 字段 | 说明 |
|------|------|------|
| 高位打板 | `methods[0].{name, score, status, note}` | 回避/观察 |
| 低位首板 | `methods[1].{...}` | 可做/观察 |
| 老龙反抽 | `methods[2].{...}` | 观察 |
| 空仓观望 | `methods[3].{...}` | 防守/备选 |

**后端计算逻辑：**
- 高位打板得分 = `100 - bombRate - limitDown×0.7`
- 低位首板得分 = `limitUp×0.7 - broken×0.3 + 30`
- 老龙反抽得分 = `50 + yesterdayPremium×8 - limitDown×0.5`
- 空仓观期能力 = `bombRate + limitDown×1.5`

---

### 5.7 明日风险 Checklist

**数据字段：**

| 字段 | 说明 |
|------|------|
| `risks[].title` | 风险标题 |
| `risks[].level` | 高/中/低 |
| `risks[].text` | 风险描述 |

自动生成规则：
- limitDown ≥ 10 → 跌停扩散风险（≥30为高）
- bombRate ≥ 30 → 炸板率偏高（≥45为高）
- sentiment ≥ 80 → 情绪高潮兑现风险
- 默认 → 三线未明显失衡（低）

---

### 5.8 明日机会 Watchlist

**数据字段：**

| 字段 | 说明 |
|------|------|
| `opportunities[].title` | 机会标题 |
| `opportunities[].grade` | A/B/C 等级 |
| `opportunities[].text` | 描述 |
| `opportunities[].trigger` | 触发条件 |

后端 `_opportunities()` 逻辑：
- 存在高风险 → 输出"等待明确信号"
- 否则取最强板块 → 输出板块前排确认机会

---

### 5.9 明日观察池

**UI 元素：** 表格（标的/题材/买点条件/优先级）

**数据字段：**

| 字段 | 来源 |
|------|------|
| `watchlist[].name` | 股票名 |
| `watchlist[].code` | 股票代码 |
| `watchlist[].theme` | 题材 |
| `watchlist[].condition` | 买点条件 |
| `watchlist[].priority` | 默认/A类/B类/C类 |

后端 `_watchlist()` 逻辑：
- 第一项固定为"空仓观望"（CASH）
- 后续取 `daban_list.stocks` 前7个打板股
- 优先级按顺序分配：A/B/B/C/C/C/C

---

## 六、衍生计算汇总

以下指标不在后端直接提供，由前端从原始字段计算：

| 衍生指标 | 计算公式 | 使用位置 |
|----------|----------|----------|
| 大盘系数 | `50 + Σindexes[].pct` | stat-row |
| 亏钱效应 | `100 - bombRate` | stat-row |
| 三线（大盘系数线） | `score×0.7 + (limitUp/(limitUp+limitDown))×30` | 三线图 |
| 三线（超短情绪线） | `score×1.05` | 三线图 |
| 三线（亏钱效应线） | `(1 - limitDown/max(limitUp,1))×100` | 三线图 |
| 冰点信号次数 | `trend.filter(t => t.score < 20).length` | 三线图 |
| 封跌比 | `limitUp / max(limitDown, 1)` | 小KPI |
| 净强度 | `limitUp - limitDown` | 涨停卡片 |
| 封跌比分级 | `limitUp > limitDown*2 ? '偏强' : '承压'` | 涨停卡片 |
| 板块进度条 | `strength / maxAllStrength × 100%` | TOP8、梯队 |
| 连板空间高度 | `max(plates[].maxBoard)` | KPI卡片 |
| 热力行排序 | 各板块 max strength 降序 | 热力图 |

---

## 七、数据字段完整索引

### 后端 API 返回的所有字段

```
meta
├── day              str     交易日 YYYY-MM-DD
├── updatedAt        str     数据更新时间
├── source           str     数据源标识
└── warnings         str[]   数据源异常

overview
├── cycle            str     情绪周期标签
├── sentiment        float   情绪综合指数
├── advice
│   ├── aggressive   str     激进型建议
│   ├── steady       str     稳健型建议
│   ├── min          int     建议仓位下限%
│   └── max          int     建议仓位上限%
├── style[]          {text, ok}  技术风格匹配
└── timePlan[]       {time, text} 关键时点预案

kpis
├── sentiment        float   情绪综合指数 0-100
├── sentimentDelta   float   较前日变化
├── limitUp          int     涨停家数
├── broken           int     炸板家数
├── limitDown        int     跌停家数
├── sealRate         float   封板率%
├── bombRate         float   炸板率%
├── yesterdayPremium float   昨日涨停溢价%
├── linkBoardPremium float   连板溢价%
├── upCount          int     上涨家数
├── downCount        int     下跌家数
├── marketAmount     float   两市成交额(亿)
├── marketAmountText str     成交额描述
├── marketVsShort    float   大盘VS超短差值
├── review           str     盘面综述
├── bombRate5d       float   5日平均炸板率%
├── firstBoardCount  int     首板家数
├── linkBoardCount   int     连板家数
├── marketAmountDelta float  成交额较前日变化率%
├── nonBoardTemp     float   非连板股市场温度 0-100
└── openPremium      str     开盘溢价（详见 8.2.1，可算法化）

indexes[]  (7项)
├── name             str     指数名称
├── code             str     代码
├── close            float   收盘价
├── diff             float   涨跌点数
├── pct              float   涨跌幅%
├── up_count         int     上涨家数
└── down_count       int     下跌家数

trend[]  (N天)
├── date             str     日期
├── score            float   情绪分数
├── limit_up         int     涨停数
├── limit_down       int     跌停数
├── amount           float   成交额(亿)
├── seal_rate        float   封板率%
├── bomb_rate        float   炸板率%
├── cycle            str     日状态标签（冰冰点/冰点/背离/耦合/退潮/常态/启动/发酵/高潮）
└── plates[]
    ├── name         str     板块名
    └── strength     float   板块强度

plates[]  (TOP10)
├── name             str     板块名称
├── pct              float   涨跌幅%
├── code             str     板块代码
├── leader           str     龙头股名
├── leaderCode       str     龙头股代码
├── leaderPct        float   龙头涨跌幅%
├── limitUps         int     涨停数
├── firstBoards      int     首板数
├── maxBoard         int     最高连板
├── strength         float   综合强度
├── role             str     主线/支线
├── stage            str     高潮/发酵/启动/轮动
├── capital          str     资金类型
├── sharePct         float   板块涨停占比%
├── middleStock      str     中军股名（详见 8.2.2，可算法化）
└── middleCode       str     中军股代码

methods[]  (4项)
├── name             str     手法名
├── score            float   得分
├── status           str     状态（回避/观察/可做/防守）
└── note             str     说明

risks[]
├── title            str     风险标题
├── level            str     高/中/低
└── text             str     风险描述

opportunities[]
├── title            str     机会标题
├── grade            str     A/B/C
├── text             str     描述
└── trigger          str     触发条件

watchlist[]  (8项)
├── name             str     标的名
├── code             str     代码
├── theme            str     题材
├── condition        str     买点条件
└── priority         str     优先级

monitor[]  (20项)
├── time             str
├── code             str
├── name             str
├── desc             str
└── value            str|number
```

---

## 八、数据缺口与改进建议

### 8.1 模板中有但当前未实现的功能

| 缺失项 | 模板位置 | 状态 | 说明 |
|--------|----------|------|------|
| 5日均炸板率 | sentiment.html 三线面板 | ✅ 已实现 | `kpis.bombRate5d`，从 trend 近5天 seal_rate 推算 |
| 开盘溢价 | sentiment.html 炸板率卡片 | 🔧 可算法化 | 详见 8.2.1，用昨日打板股+TDX报价计算 |
| 非连板股市场温度 | AAR.html 周期定位 | ✅ 已实现 | `kpis.nonBoardTemp`，非涨跌停股中上涨占比 |
| 首板/连板拆分 | AAR.html 涨跌停家数 | ✅ 已实现 | `kpis.firstBoardCount` / `linkBoardCount`，从 zhangfu.info.sj_zt 获取 |
| 成交额变化率 | AAR.html 两市成交额 | ✅ 已实现 | `kpis.marketAmountDelta`，trend 相邻两天对比 |
| 板块占比 | AAR.html 梯队卡片 | ✅ 已实现 | `plates[].sharePct`，板块涨停数占总涨停数比例 |
| 中军股 | AAR.html 梯队卡片 | 🔧 可算法化 | 详见 8.2.2，用 TDX 板块成分股按市值排序选取 |
| date-grid 状态 | sentiment.html | ✅ 已实现 | `_daily_status()` 输出 冰冰点/背离/耦合/常态 等细分标签 |
| 热力图排序切换 | sentiment.html | ⏳ 前端待做 | 按钮存在但无交互逻辑，纯前端功能 |
| 逐日封板率/炸板率 | 三线图 & 各面板 | ✅ 已实现 | `trend[].seal_rate` / `trend[].bomb_rate` |

### 8.2 AI 依赖字段清单

以下字段原标记为 `"AI依赖"` 占位，经审核分析后均可通过现有数据源算法化实现：

#### 8.2.1 `kpis.openPremium` — 开盘溢价

**位置**：情绪仪表盘炸板率卡片、明日策略KPI

**需求含义**：昨日涨停股今日开盘的平均涨幅（反映竞价情绪延续性）

**可用数据源**：
- `kpl.history.daban_list(yesterday)` → 昨日打板股列表（code/name/concept）
- `opentdx.stock_quotes(codes)` → 批量获取 open / pre_close

**实现方案**：
```python
# 1. 获取昨日打板股
prev_day = recent_weekdays(active_day, 2)[0]
yesterday_board = kpl.history.daban_list(prev_day)
codes = [(market_from_code(s.code), s.code) for s in yesterday_board.stocks[:30]]

# 2. 批量查报价
with TdxClient() as client:
    quotes = client.stock_quotes(codes)

# 3. 计算平均开盘溢价
premiums = [(q['open'] - q['pre_close']) / q['pre_close'] * 100 for q in quotes if q['pre_close'] > 0]
open_premium = round(sum(premiums) / max(len(premiums), 1), 2)
```

**额外 API 开销**：1 次 `daban_list` + 1 次 `stock_quotes`，可接受。

**替代方案**：若需更精确的集合竞价数据，可用 `opentdx.stock_auction`（仅盘中可用），或在 `_build_history_trend` 中缓存前一日 daban_list 避免重复请求。

---

#### 8.2.2 `plates[].middleStock` / `middleCode` — 中军股

**位置**：明日策略板块梯队卡片

**需求含义**：板块内非龙头的"中坚力量"——市值较大、换手活跃、对板块走势有锚定作用的个股

**可用数据源**：
- `opentdx.board_members_quotes(board_code, count=20)` → 板块成分股行情（含 total_market_cap_ab / turnover / close / pre_close）

**实现方案**：
```python
def _pick_middle_stock(self, plate_code: str, leader_code: str) -> tuple[str, str]:
    """选板块中军：按市值降序，跳过龙头取次席。"""
    with TdxClient() as client:
        members = client.stock_board_members(
            plate_code, count=20,
            sort_type=SORT_TYPE.MARKET_CAP,  # 按市值排
            sort_order=SORT_ORDER.DESC,
        )
    for m in members:
        code = m.get('code', '')
        if code and code != leader_code:
            return m.get('name', ''), code
    return '', ''
```

**中军选取策略**（可组合）：
1. **市值优先**：取市值最大且非龙头的个股（核心方案）
2. **换手率优先**：取换手率最高且涨幅>0的非龙头个股（流动性代表）
3. **涨幅筛选**：过滤涨幅 > 0 的成分股再排市值（确保是正向贡献者）

**额外 API 开销**：每个板块 1 次 `board_members_quotes`，TOP10 板块 = 10 次调用。可用并发或缓存优化。

**MCP 验证结果**（板块 881270 元件，按市值排序前5）：

| 股票 | 市值(亿) | 换手率% | 涨幅% |
|------|---------|---------|-------|
| 四方股份 | 63.87 | 4.10 | +1.33 |
| 科大智能 | 12.78 | 10.77 | +0.92 |
| 中元股份 | 6.34 | 4.66 | +0.62 |
| 申昊科技 | 5.67 | 9.52 | +1.34 |
| 派诺科技 | 1.50 | 7.42 | +4.24 |

龙头为胜业电气(920128)，中军按市值应取四方股份(601126)——市值最大、涨幅正向，符合"中军"定位。

---

#### 8.2.3 实现优先级

| 字段 | 实现难度 | API 开销 | 建议 |
|------|---------|---------|------|
| `middleStock` | ⭐ 低 | 10次/请求 | 可直接实现，按市值排即得 |
| `openPremium` | ⭐⭐ 中 | 2次/请求 | 需查昨日打板股+今日报价，非交易时段可能无竞价数据 |
| `firstBoards` 区分 | ⭐⭐ 中 | 0（利用已有数据） | 当前 firstBoards=limitUps 是同一个值，可从 daban_list ext 字段或 kline 判断首板 vs 连板 |

### 8.3 已实现的新增字段（后端 + 前端类型）

```python
# kpis 新增（均已实现）
{
    "bombRate5d": float,          # 5日平均炸板率
    "firstBoardCount": int,       # 首板家数
    "linkBoardCount": int,        # 连板家数
    "marketAmountDelta": float,   # 成交额较前日变化率%
    "nonBoardTemp": float,        # 非连板股市场温度 0-100
    "openPremium": str,           # 可算法化（详见 8.2.1）
}

# plates[] 新增（均已实现）
{
    "sharePct": float,            # 板块涨停占比%
    "middleStock": str,           # 可算法化（详见 8.2.2）
    "middleCode": str,            # 同上
}

# trend[] 新增（均已实现）
{
    "seal_rate": float,           # 逐日封板率%
    "bomb_rate": float,           # 逐日炸板率%
    # cycle 标签增强：冰冰点/冰点/背离/耦合/退潮/常态/启动/发酵/高潮
}
```

### 8.4 API 层改进建议

1. **时间范围参数**：`trend` 数据量固定（近15天），建议支持 `range=5|15|30|60` 参数
2. **板块热力图独立接口**：trend 中每点带 15 个板块数据，数据量较大，可考虑独立接口分页
3. **实时推送**：当前 45 秒轮询缓存，可考虑 WebSocket 推送盘中变化
