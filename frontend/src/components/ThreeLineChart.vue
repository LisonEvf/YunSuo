<script setup lang="ts">
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
</script>

<template>
  <svg :viewBox="`0 0 ${width} ${height}`" width="100%" :height="height" role="img" aria-label="三线趋势图">
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
  </svg>
</template>
