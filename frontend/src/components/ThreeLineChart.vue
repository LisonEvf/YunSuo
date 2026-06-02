<script setup lang="ts">
import { ref, computed } from 'vue'

const props = withDefaults(
  defineProps<{
    lines: Array<{ values: number[]; color: string; fill: string }>
    labels: string[]
    icePoints?: number[]
    height?: number
  }>(),
  { icePoints: () => [], height: 400 },
)

const width = 900
const pad = { top: 40, right: 30, bottom: 60, left: 60 }
const innerW = width - pad.left - pad.right
const innerH = props.height - pad.top - pad.bottom

const hoverIndex = ref(-1)

function yOf(value: number) {
  return pad.top + (1 - value / 100) * innerH
}

function xOf(index: number) {
  const count = Math.max(props.labels.length - 1, 1)
  return pad.left + (index / count) * innerW
}

function linePoints(values: number[]) {
  return values.map((v, i) => `${xOf(i)},${yOf(v)}`).join(' ')
}

function areaPath(values: number[]) {
  if (!values.length) return ''
  const top = values.map((v, i) => `${xOf(i)},${yOf(v)}`).join(' L ')
  const baseY = pad.top + innerH
  return `M ${xOf(0)},${baseY} L ${top} L ${xOf(values.length - 1)},${baseY} Z`
}

const gridLines = [0, 20, 40, 60, 80, 100]

const tooltipData = computed(() => {
  if (hoverIndex.value < 0) return null
  const idx = hoverIndex.value
  return {
    x: xOf(idx),
    label: props.labels[idx] ?? '',
    values: props.lines.map(l => ({
      color: l.color,
      value: l.values[idx],
    })),
  }
})

function onMouseMove(e: MouseEvent) {
  const svg = e.currentTarget as SVGSVGElement
  const rect = svg.getBoundingClientRect()
  const scaleX = width / rect.width
  const mouseX = (e.clientX - rect.left) * scaleX
  const count = Math.max(props.labels.length - 1, 1)
  const stepW = innerW / count
  const idx = Math.round((mouseX - pad.left) / stepW)
  hoverIndex.value = idx >= 0 && idx < props.labels.length ? idx : -1
}

function onMouseLeave() {
  hoverIndex.value = -1
}
</script>

<template>
  <svg :viewBox="`0 0 ${width} ${height}`" width="100%" :height="height" role="img" aria-label="三线趋势图" @mousemove="onMouseMove" @mouseleave="onMouseLeave">
    <!-- 高潮区 80-100 背景 -->
    <rect :x="pad.left" :y="yOf(100)" :width="innerW" :height="yOf(80) - yOf(100)" fill="rgba(239,44,103,.06)" />
    <!-- 冰点区 0-20 背景 -->
    <rect :x="pad.left" :y="yOf(20)" :width="innerW" :height="yOf(0) - yOf(20)" fill="rgba(61,126,255,.06)" />

    <!-- 网格线 -->
    <g stroke="rgba(136,136,170,.15)" stroke-width="1">
      <line v-for="v in gridLines" :key="v" :x1="pad.left" :x2="width - pad.right" :y1="yOf(v)" :y2="yOf(v)" />
      <line :x1="pad.left" :y1="pad.top" :x2="pad.left" :y2="pad.top + innerH" />
      <line :x1="pad.left" :y1="pad.top + innerH" :x2="width - pad.right" :y2="pad.top + innerH" />
    </g>

    <!-- Y轴标签 -->
    <g fill="#778392" font-size="13" text-anchor="end">
      <text v-for="v in gridLines" :key="v" :x="pad.left - 8" :y="yOf(v) + 4">{{ v }}</text>
    </g>

    <!-- 区域标签 -->
    <text :x="pad.left + innerW / 2" :y="yOf(90) + 4" fill="#7b8796" font-size="12" text-anchor="middle">高潮区 80-100</text>
    <text :x="pad.left + innerW / 2" :y="yOf(10) + 4" fill="#7b8796" font-size="12" text-anchor="middle">冰点区 0-20</text>

    <!-- 数据线 (先画填充, 再画线) -->
    <template v-for="(line, li) in lines" :key="'a' + li">
      <path :d="areaPath(line.values)" :fill="line.fill" />
    </template>
    <template v-for="(line, li) in lines" :key="'l' + li">
      <polyline :points="linePoints(line.values)" fill="none" :stroke="line.color" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    </template>

    <!-- 数据点 (中间的) -->
    <template v-for="(line, li) in lines" :key="'d' + li">
      <g :fill="line.color">
        <circle v-for="(v, vi) in line.values.slice(0, -1)" :key="vi" :cx="xOf(vi)" :cy="yOf(v)" r="4" />
      </g>
    </template>

    <!-- 末端数据点 (空心圆) -->
    <template v-for="(line, li) in lines" :key="'e' + li">
      <circle
        v-if="line.values.length"
        :cx="xOf(line.values.length - 1)"
        :cy="yOf(line.values[line.values.length - 1])"
        r="7"
        fill="#fff"
        :stroke="line.color"
        stroke-width="4"
      />
    </template>

    <!-- 冰点三角标记 -->
    <g v-if="icePoints.length" fill="#3d7eff">
      <path v-for="idx in icePoints" :key="idx" :d="`M${xOf(idx)} ${yOf(100) - 10} l8 16 h-16z`" />
    </g>

    <!-- X轴日期标签 -->
    <g fill="#778392" font-size="13">
      <text v-for="(label, i) in labels" :key="i" :x="xOf(i)" :y="pad.top + innerH + 20" text-anchor="middle">{{ label }}</text>
    </g>

    <!-- Hover 竖线 -->
    <line v-if="tooltipData" :x1="tooltipData.x" :x2="tooltipData.x" :y1="pad.top" :y2="pad.top + innerH" stroke="rgba(136,136,170,.4)" stroke-width="1" stroke-dasharray="4 2" />

    <!-- Hover 数据点高亮 -->
    <template v-if="tooltipData">
      <circle v-for="item in tooltipData.values" :key="item.color" :cx="tooltipData.x" :cy="yOf(item.value ?? 0)" r="5" :fill="item.color" stroke="#fff" stroke-width="2" />
    </template>

    <!-- Tooltip 框 -->
    <g v-if="tooltipData">
      <rect :x="Math.min(tooltipData.x + 12, width - 180)" :y="pad.top" width="160" :height="16 + tooltipData.values.length * 20 + 4" rx="6" fill="var(--bg-card)" stroke="var(--border-color)" stroke-width="1" opacity=".95" />
      <text :x="Math.min(tooltipData.x + 20, width - 172)" :y="pad.top + 14" fill="var(--text-secondary)" font-size="12">{{ tooltipData.label }}</text>
      <text v-for="(item, i) in tooltipData.values" :key="item.color" :x="Math.min(tooltipData.x + 20, width - 172)" :y="pad.top + 30 + i * 20" :fill="item.color" font-size="13" font-weight="700">{{ typeof item.value === 'number' ? item.value.toFixed(1) : '--' }}</text>
    </g>
  </svg>
</template>
