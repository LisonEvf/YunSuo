# 数据验证报告 — MCP 交叉校验

> 基于实际 MCP 数据源对 `template/sentiment.html`（情绪仪表盘）和 `template/AAR.html`（明日策略看板）页面渲染数据的逐字段验证。
>
> 验证日期：2026-06-03 | 数据采样日：2026-06-02

---

## 一、验证概要

| 类别 | 数量 | 说明 |
|------|------|------|
| ✅ 有确切来源的正确数据 | 22 | MCP 多源交叉验证一致 |
| ⚠️ 数据源差异需关注 | 6 | 多来源数值不同，需确定取哪个 |
| ❌ 标记"AI依赖"未实现 | 2 | `openPremium`、`middleStock` |
| 🔧 计算逻辑有缺陷 | 5 | 首板/连板未区分、匹配逻辑粗糙等 |
| 📋 新发现数据需求 | 4 | 本次验证中发现的需求缺口 |

---

## 二、MCP 实际返回数据采样（2026-06-02）

### 2.1 emotion_today（核心情绪数据）

| 字段 | 原始Key | 值 | 对应API字段 |
|------|---------|------|-------------|
| 涨停家数 | `DaBanList.tZhangTing` | 64 | `kpis.limitUp` |
| 跌停家数 | `DaBanList.tDieTing` | 13 | `kpis.limitDown` |
| 封板率 | `DaBanList.tFengBan` | 75.29% | `kpis.sealRate` |
| 炸板家数 | `DaBanList.PPJS` | 76 | `kpis.broken` |
| 上涨家数 | `DaBanList.SZJS` | 1372 | `kpis.upCount` |
| 下跌家数 | `DaBanList.XDJS` | 3739 | `kpis.downCount` |
| 综合强度 | `DaBanList.ZHQD` | 47 | `kpis.sentiment` |
| 昨日涨停溢价 | `DaBanList.ZRZTJ` | 1.146% | `kpis.yesterdayPremium` |
| 连板溢价 | `DaBanList.ZRLBJ` | 0.927% | `kpis.linkBoardPremium` |
| 两市成交额 | `DaBanList.qscln` | 279299210万元 ≈ 27929亿 | `kpis.marketAmount` |

### 2.2 zhangfu_detail（涨幅分布）

| 字段 | Key | 值 | 对应用途 |
|------|-----|------|----------|
| 实际涨停 | `SJZT` | 64 | 与 emotion_today 交叉验证 ✅ |
| 实际跌停 | `SJDT` | 13 | 与 emotion_today 交叉验证 ✅ |
| 总涨停(含ST) | `ZT` | 93 | 参考 |
| ST涨停 | `STZT` | 29 | 参考 |
| 总跌停(含ST) | `DT` | 15 | 参考 |
| ST跌停 | `STDT` | 2 | 参考 |
| 上涨家数 | `SZJS` | 1372 | 与 emotion_today 交叉验证 ✅ |
| 下跌家数 | `XDJS` | 3739 | 与 emotion_today 交叉验证 ✅ |
| 盘面综述 | `sign` | "市场人气较好" | `kpis.review` |

### 2.3 market_scln（两市成交额）

| 字段 | 值 | 说明 |
|------|------|------|
| `last` | 279299210 (万元) | = 27929.92 亿 |
| `yclnstr` | "27929亿(-2.94%,缩量844亿)" | 成交额描述文本 |

### 2.4 weight_performance（板块权重表现）

| 方向 | 板块 | 代码 | 涨幅% | 龙头 | 龙头涨幅 |
|------|------|------|-------|------|----------|
| SZ(涨) | 元件 | 881270 | +3.80 | 胜业电气(920128) | +30.00 |
| SZ(涨) | 通信设备 | 881129 | +2.50 | 阿莱德(301419) | +20.00 |
| SZ(涨) | 有色冶炼加工 | 881113 | +2.34 | 宜安科技(300328) | +11.34 |
| XD(跌) | 化学制药 | 881140 | -2.11 | 纳微科技(688690) | +4.08 |
| XD(跌) | 光伏设备 | 881279 | -1.95 | *ST天宜(688033) | +6.77 |
| XD(跌) | 电网设备 | 881278 | -1.88 | 煜邦电力(688597) | +10.69 |

### 2.5 disk_review（盘面复盘）

| 字段 | 值 |
|------|------|
| `strong` | 47 |
| `sign` | "短期大盘趋势偏弱，增量资金入场未见明显，市场赚钱效应偏弱" |

### 2.6 sharp_withdrawal（急速回撤/炸板）

| 字段 | 值 |
|------|------|
| `num` | 4 |
| 代表个股 | 泓淋电力(-4.09%)、杭州园林(+3.13%)、*ST易录(-7.17%) |

### 2.7 TDX 指数（上证指数）

| 字段 | 值 |
|------|------|
| close | 4075.10 |
| pre_close | 4057.74 |
| diff | +17.36 |
| up_count | 662 |
| down_count | 1654 |

---

## 三、逐字段验证结果

### 3.1 ✅ 有确切来源的正确数据

以下数据经多源交叉验证一致，来源可靠：

| API字段 | 来源1 | 来源2 | 验证结果 |
|----------|-------|-------|----------|
| `meta.day` | `market_status.Day` = "2026-06-02" | `emotion_today.Day` = "2026-06-02" | ✅ 一致 |
| `kpis.limitUp` | `DaBanList.tZhangTing` = 64 | `zhangfu_detail.SJZT` = 64 | ✅ 一致 |
| `kpis.limitDown` | `DaBanList.tDieTing` = 13 | `zhangfu_detail.SJDT` = 13 | ✅ 一致 |
| `kpis.sealRate` | `DaBanList.tFengBan` = 75.29% | — | ✅ 单源可靠 |
| `kpis.bombRate` | 计算: 100 - 75.29 = 24.71% | — | ✅ 派生正确 |
| `kpis.upCount` | `DaBanList.SZJS` = 1372 | `zhangfu_detail.SZJS` = 1372 | ✅ 一致 |
| `kpis.downCount` | `DaBanList.XDJS` = 3739 | `zhangfu_detail.XDJS` = 3739 | ✅ 一致 |
| `kpis.yesterdayPremium` | `DaBanList.ZRZTJ` = 1.146% | — | ✅ 单源可靠 |
| `kpis.linkBoardPremium` | `DaBanList.ZRLBJ` = 0.927% | — | ✅ 单源可靠 |
| `kpis.marketAmount` | `DaBanList.qscln` / 10000 = 27929.9亿 | `market_scln.last` = 27929.9亿 | ✅ 一致 |
| `kpis.marketAmountText` | `market_scln.yclnstr` = "27929亿(-2.94%,缩量844亿)" | — | ✅ 可用 |
| `kpis.sentiment`(当日) | `DaBanList.ZHQD` = 47 | — | ✅ 单源可靠 |
| `kpis.review` | `disk_review.sign` | `zhangting_expression.sign`(备选) | ✅ 可用 |
| `indexes[].close/diff/pct` | TDX `index_info` | — | ✅ 实时行情 |
| `plates[].name/pct/leader` | `weight_performance.sz[]` | `weight_performance_list.info[]` | ✅ 一致 |
| `overview.cycle` | 由 ZHQD=47、limitDown=13、bombRate=24.71 → "常态" | — | ✅ 逻辑正确 |
| `overview.advice` | 常态 → 激进"1-3成试错" / 稳健"1-2成" | — | ✅ 逻辑正确 |
| `overview.style` | cycle=常态 → 主线核心ok、龙头换手板ok | — | ✅ 逻辑正确 |
| `watchlist[]` | `daban_list.stocks` 前7只 + 空仓 | — | ✅ 可用 |
| `monitor[]` | TDX `market_monitor` | — | ✅ 实时数据 |
| `risks[]` | limitDown=13→中、bombRate=24.71→不触发 | — | ✅ 自动生成 |
| `methods[]` | 基于已有KPI计算 | — | ✅ 派生正确 |

### 3.2 ⚠️ 数据源差异需关注

#### 3.2.1 炸板家数 `kpis.broken` — 来源确认

| 来源 | Key | 值 | 说明 |
|------|-----|------|------|
| `history_get_num` | `PB` | 取当日值 | **正确来源**：平板/破板数 |
| `emotion_today` | `DaBanList.PPJS` | 76 | ❌ **平盘家数**（flat stocks），不是炸板数 |
| `sharp_withdrawal` | `num` | 4 | ❌ **急速回撤**（极端跳水），窄口径 |
| fallback 计算 | seal_rate反推 | ≈21 | limitUp * (100-sealRate) / sealRate |

**结论**：当前后端逻辑正确。`daily_nums.pb` 为主，fallback 为 seal_rate 反推（≈21）。PPJS ≠ 炸板数。

#### 3.2.2 情绪综合指数 — 当日 vs 历史日算法不一致

| 场景 | 数据来源 | 可靠性 |
|------|----------|--------|
| 当日 | `DaBanList.ZHQD` = 47 | ✅ KPL原生值，可靠 |
| 历史日 | 自定义公式计算 | ⚠️ `zhangting_expression.feng_ban_lv` 对历史日不准确 |

**当前后端逻辑**（[services.py:373-390](backend/app/services.py#L373-L390)）：
```python
score = pick_number(getattr(daban, "zhqd", None), default=-1)
if score >= 0:
    return round(max(0, min(score, 100)), 1)  # 用 KPL 原生值
# fallback: 自定义公式（历史日走这个分支）
```

**问题**：历史日 trend 每天都调用 `zhangting_expression(day)`，其中 `feng_ban_lv` 字段对历史日不准确（后端代码注释已承认），导致历史日情绪分数偏差。

**建议**：
- 历史日情绪分数改用 `limitUp`、`limitDown`、`zhangfu_detail` 的 SZJS/XDJS 计算（这些字段历史日可靠）
- 或在 `_build_history_trend` 中缓存当日 ZHQD 值

#### 3.2.3 涨停总数 vs 实际涨停

| 统计口径 | 值 | 说明 |
|----------|------|------|
| `ZT`（总涨停含ST） | 93 | 宽口径 |
| `SJZT`（实际涨停） | 64 | 窄口径，不含ST |
| `STZT`（ST涨停） | 29 | ST板块 |
| `tZhangTing`（打板） | 64 | 与 SJZT 一致 |

**当前后端取值**：优先取 `SJZT` / `tZhangTing`，✅ 正确。

#### 3.2.4 上涨/下跌家数 — TDX vs KPL 不一致

| 来源 | 上涨 | 下跌 |
|------|------|------|
| KPL `DaBanList` | 1372 | 3739 |
| TDX 上证指数 | 662 | 1654 |

**分析**：KPL 统计全市场（含深交所），TDX `index_info` 的 up_count/down_count 仅统计该指数成分股。**这不是 bug，是口径差异**。

**当前后端逻辑**：`kpis.upCount` / `kpis.downCount` 取 KPL 的全市场数据。✅ 正确。

#### 3.2.5 板块-个股匹配逻辑粗糙

**当前逻辑**（[services.py:486](backend/app/services.py#L486)）：
```python
related = [s for s in stocks if row["name"] and row["name"] in getattr(s, "concept", "")]
```

**问题**：
- `concept` 格式为 `"AI PC、端侧AI"`，`row["name"]` 为 `"元件"`
- 包含匹配(`"元件" in "AI PC、端侧AI"`) 会失败 → 漏匹配
- 而 `"通信" in "通信、算力"` 能成功 → 前缀匹配命中

**MCP 验证**：`daban_list` 中 "春秋电子" 的 concept = `"AI PC、端侧AI"`，不包含板块名 "元件"。

**影响**：`plates[].limitUps`、`plates[].firstBoards`、`plates[].maxBoard`、`plates[].leader` 都依赖匹配结果，匹配失败导致这些字段全为 0。

**建议**：
1. 使用 `weight_performance` 返回的龙头信息（已有 `stock_name`/`stock_code`），不再依赖 concept 匹配
2. 或建立板块名 → concept 关键词的映射表（如 `"元件" → ["元器件", "电阻电容"]`）

#### 3.2.6 板块涨跌幅 `plates[].pct` — 两个来源精度不同

| 来源 | 示例 |
|------|------|
| `weight_performance.sz[]` → `plate_pct` | 3.8（1位小数） |
| `weight_performance_list.info[]` → `pct` | 3.8（同） |

两者一致。但 `weight_performance_list` 还返回 `change_pct` 字段（如 0.033 = 3.3%），与 `pct`（3.8%）不一致——前者是资金净流入变化率，后者是板块涨跌幅。后端取的是 `pct`。✅ 正确。

---

### 3.3 ❌ "AI依赖"未实现字段

| 字段 | 页面位置 | 状态 | 实现方案 |
|------|----------|------|----------|
| `kpis.openPremium` | 炸板率卡片、KPI卡片 | ❌ 占位 `"AI依赖"` | 见需求文档 8.2.1，需 `daban_list(昨日)` + `stock_quotes` |
| `plates[].middleStock` | 板块梯队卡片 | ❌ 占位 `"AI依赖"` | 见需求文档 8.2.2，需 `board_members_quotes` 按市值排 |

**MCP 验证中军股可行性**：

板块 881270（元件）按市值排序前3（`board_members_quotes` sort_by=5 降序）：

| 股票 | 代码 | 市值(亿) | 涨跌幅% |
|------|------|---------|---------|
| 新风光 | 688663 | 126.2 | -4.48% |
| 杭州柯林 | 688611 | 116.4 | -0.63% |
| 四方股份 | 601126 | 63.9 | 0% |

龙头为胜业电气(920128)，按"市值最大且非龙头"规则，中军应为 **新风光(688663)**（市值126亿）。但新风光当日跌4.48%——按"涨幅>0"筛选则应取四方股份(601126)。

**建议**：中军选取策略改为"涨幅正向 + 市值优先"组合筛选。

---

### 3.4 🔧 计算逻辑缺陷

#### 3.4.1 首板/连板未区分

**当前代码**（[services.py:488](backend/app/services.py#L488)）：
```python
row["firstBoards"] = len(related)  # 等于 limitUps
```

**问题**：`firstBoards` 和 `limitUps` 完全相同，没有区分首板股和连板股。

**MCP 数据验证**：`daban_list` 的 `ext` 字段包含连板信息（如 `"6天5板"`），`_infer_max_board()` 已利用此信息推断最高连板数。

**建议**：
- 首板数 = `limitUps` - 连板股数
- 连板股 = `ext` 中包含"N板"/"N连"的个股
- 或利用 `zhangfu_detail` 的分布数据（info["0"]=76 首0板、info["1"]=434 首1板... 但含义待确认）

#### 3.4.2 资金类型判断过于简单

**当前逻辑**：`pct >= 2 → "机构主导"`，否则 `"混合博弈"`。

**问题**：仅用板块涨幅判断资金类型不准确。涨2%可能是游资合力推动。

**建议**：
- 利用 `zhangfu_detail.ZSZDFB`（涨跌分布）数据辅助判断
- 或取 TDX `symbol_zjlx`（资金流向）接口判断主力净流入

#### 3.4.3 板块强度公式权重不合理

**当前公式**：`abs(pct) * 1000 + limitUps * 850 + leaderPct * 100`

**问题**：
- 涨幅权重 1000，涨停家数权重 850，龙头涨幅权重 100
- 当 `limitUps=0`（匹配失败时），强度仅由 `pct` 决定
- 元件 pct=3.8 → strength=3800（无个股匹配时），有匹配后加 limitUps*850
- 实际MCP数据：元件 strength 应远高于其他板块

**建议**：
- 加入 `maxBoard` 权重（连板高度代表板块纵深）
- 加入 `firstBoards` 权重（首板数量代表板块广度）
- 参考公式：`abs(pct)*800 + limitUps*600 + maxBoard*1200 + firstBoards*400`

#### 3.4.4 情绪周期标签粒度不足

**当前 `_daily_status()` 有9种标签**：冰冰点/冰点/背离/耦合/退潮/常态/启动/发酵/高潮
**但 `_cycle_label()` 只有6种**：冰点/退潮/常态/启动/发酵/高潮

**问题**：
- `trend[].cycle` 用 `_daily_status()`（9种）
- `overview.cycle` 用 `_cycle_label()`（6种）
- 两者对同一数据可能给出不一致的标签

**建议**：统一为一套标签体系，或明确 daily_status 是 cycle_label 的细化版本。

#### 3.4.5 `marketVsShort` 计算含义模糊

**当前公式**：`abs(avg_index_pct * 10 - sentiment / 10)`

**示例**：avg_index_pct ≈ -0.39%, sentiment=47
→ `abs(-0.39*10 - 47/10) = abs(-3.9 - 4.7) = 8.6`

**问题**：将"平均指数涨跌幅×10"与"情绪分数/10"做差，物理含义不清晰。

**建议**：
- 大盘系数和超短情绪应该归一化到同一量纲后再比较
- 或改为：`sentiment - (upCount/(upCount+downCount)*100)`，两者都是0-100的百分比

---

## 四、前端衍生计算审查

以下公式在前端执行，后端仅提供原始字段。需要审查其合理性：

| 衍生指标 | 公式 | 问题 |
|----------|------|------|
| 大盘系数 | `50 + Σindexes[].pct` | 7个指数涨跌幅求和+50，数值范围不稳定。如当日全部跌1%，大盘系数=50-7=43，合理吗？建议改为 `50 + avg(indexes[].pct)*10` |
| 超短情绪线 | `score × 1.05` | 乘1.05缺乏理论依据，只是放大效果。建议直接用 `score` 或换一个独立计算 |
| 亏钱效应线 | `(1 - limitDown/max(limitUp,1)) × 100` | 当 limitDown > limitUp 时变负值，需 clamp 到 [0, 100]。建议改为 `min(100, max(0, ...))` |
| 冰点信号 | `score < 20` | 阈值20是否合理？当日数据中 score=47（常态），近15天需检查是否有<20的 |
| 封跌比 | `limitUp / max(limitDown, 1)` | 当 limitDown=0 时结果为 limitUp，如64/1=64，无实际意义。建议 limitDown=0 时显示 ">50" |

---

## 五、新增数据需求

以下需求在验证过程中发现，原需求文档未覆盖：

### 5.1 🔴 急速回撤独立指标

**现状**：`sharp_withdrawal` 数据仅用于辅助统计，未在页面直接展示。

**MCP 数据**：`sharp_withdrawal` 返回当日急速回撤股列表（含代码、名称、涨幅、回撤幅度、换手率），是非常有价值的盘中风险信号。

**需求**：
- 在风险提示面板增加"急速回撤"指标
- 展示字段：`sharp_withdrawal.num`（数量）、TOP3 个股名称和回撤幅度
- 阈值：num ≥ 5 触发风险提示

### 5.2 🟡 板块涨跌分布数据

**MCP 数据**：`zhangfu_detail.ZSZDFB` = `"589,1594,29,176,317,7,69,215,8,31,19,0,29,21,0,138,159,3,"`

**含义**：按涨跌幅分档的股票分布（-9%以下, -8~-9%, ..., +8~+9%, +9%以上），可用于：
- 市场温度计（涨跌比可视化）
- 判断市场极端程度
- 前端可用柱状图/分布图展示

**需求**：新增 `kpis.zhangfuDistribution` 字段，返回分档分布数组。

### 5.3 🟡 打板股连板详情

**MCP 数据**：`daban_list` 的每只股票有 `ext` 字段，包含连板信息（如 `"6天5板"`）。

**需求**：
- 在观察池 `watchlist` 中增加连板信息展示
- 在板块梯队中区分"首板股"和"连板股"数量
- 具体字段：`watchlist[].boardInfo`（如 "5板"、"首板"）

### 5.4 🟡 ST 股涨停独立展示

**MCP 数据**：`zhangfu_detail.STZT` = 29, `STDT` = 2

**现状**：涨停数取 SJZT=64（不含ST），但页面未展示 ST 涨停情况。ST 批量涨停往往是弱势市场信号。

**需求**：在涨跌停卡片区域增加 ST 涨停/跌停数的小字提示。

---

## 六、改进优先级建议

| 优先级 | 改进项 | 影响 | 工作量 | 状态 |
|--------|--------|------|--------|------|
| P0 | 修复板块-个股 concept 匹配逻辑 | 板块数据大面积失真 | 低 | ✅ 已修复 |
| P0 | 确认炸板家数来源 | kpis.broken | 低 | ✅ 已确认正确 |
| P1 | 实现 `middleStock` 中军股 | 梯队卡片缺数据 | 低 | ✅ 已修复 |
| P1 | 区分首板/连板数 | 梯队卡片精度 | 中 | ✅ 已修复 |
| P1 | 修复 sj_zt 误用为首板数 | firstBoardCount 错误 | 低 | ✅ 已修复 |
| P1 | 优化历史日情绪分数算法 | 三线图历史数据偏差 | 中 | ✅ 已修复 |
| P2 | 实现 `openPremium` 开盘溢价 | 炸板率卡片缺数据 | 中 | ✅ 已修复 |
| P2 | 优化资金类型判断 | capital 字段不准确 | 中 | ✅ 已修复 |
| P2 | 新增急速回撤风险指标 | 风险面板不完整 | 低 | ✅ 已修复 |
| P2 | 优化板块强度公式 | strength 权重不合理 | 低 | ✅ 已修复 |
| P3 | 新增涨跌幅分布可视化 | 市场温度增强 | 中 | ✅ 已修复 |
| P3 | 前端三线公式归一化 | 衍生指标物理含义不清 | 中 | ✅ 已修复 |
| P3 | 统一情绪周期标签体系 | 两个函数不一致 | 低 | ✅ 已修复 |

---

## 七、数据质量总结

```
┌─────────────────────────────────────────────────────┐
│              数据质量评分（基于 MCP 交叉验证）          │
├─────────────────┬──────────┬────────────────────────┤
│ 类别             │ 评分     │ 说明                    │
├─────────────────┼──────────┼────────────────────────┤
│ 核心KPI          │ ⭐⭐⭐⭐⭐ │ 多源一致，可靠           │
│ 指数行情          │ ⭐⭐⭐⭐⭐ │ TDX 实时数据             │
│ 当日情绪指数      │ ⭐⭐⭐⭐   │ ZHQD 原生值可靠          │
│ 历史日趋势数据    │ ⭐⭐⭐    │ 封板率历史日不准确        │
│ 板块排名          │ ⭐⭐⭐⭐   │ 排名准确，个股匹配有缺陷  │
│ 板块个股数据      │ ⭐⭐      │ concept 匹配失败率高      │
│ 风险/机会/手法    │ ⭐⭐⭐⭐   │ 自动生成逻辑合理          │
│ 衍生指标          │ ⭐⭐⭐    │ 部分公式缺乏理论依据      │
└─────────────────┴──────────┴────────────────────────┘
```

**最高风险项**：板块-个股 concept 匹配逻辑（P0），当前匹配失败率高，导致板块的涨停数、龙头、连板高度等关键字段可能全为0/空。
