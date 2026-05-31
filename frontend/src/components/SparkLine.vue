<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    values: number[]
    color?: string
    fill?: string
    height?: number
  }>(),
  {
    color: '#ef2c67',
    fill: 'rgba(239, 44, 103, 0.15)',
    height: 220,
  },
)

const width = 580
const padding = 28

function points() {
  if (!props.values.length) return ''
  const min = Math.min(...props.values)
  const max = Math.max(...props.values)
  const span = max - min || 1
  return props.values
    .map((value, index) => {
      const x = padding + (index * (width - padding * 2)) / Math.max(props.values.length - 1, 1)
      const y = padding + (1 - (value - min) / span) * (props.height - padding * 2)
      return `${x},${y}`
    })
    .join(' ')
}

function areaPoints() {
  const line = points()
  if (!line) return ''
  return `${padding},${props.height - padding} ${line} ${width - padding},${props.height - padding}`
}
</script>

<template>
  <svg :viewBox="`0 0 ${width} ${height}`" width="100%" :height="height" aria-hidden="true">
    <g stroke="rgba(136,136,170,.18)" stroke-width="1">
      <line v-for="i in 4" :key="i" :x1="padding" :x2="width - padding" :y1="padding + i * 38" :y2="padding + i * 38" />
    </g>
    <polygon :points="areaPoints()" :fill="fill" />
    <polyline :points="points()" fill="none" :stroke="color" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
    <circle
      v-for="point in points().split(' ')"
      :key="point"
      :cx="Number(point.split(',')[0])"
      :cy="Number(point.split(',')[1])"
      r="5"
      :fill="color"
    />
  </svg>
</template>
