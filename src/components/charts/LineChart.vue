<script setup>
import { watchEffect } from 'vue'
import * as d3 from 'd3'
import { useChartSize } from './useChartSize'

const props = defineProps({
  // [{ label: string, value: number }] — drawn in the order given.
  data: { type: Array, required: true },
  height: { type: Number, default: 240 },
  color: { type: String, default: '#3e5c76' }
})

const { host, width } = useChartSize()

watchEffect(() => {
  const el = host.value
  if (!el) return

  const rows = props.data
  const w = width.value
  const margin = { top: 14, right: 16, bottom: 44, left: 40 }
  const innerW = Math.max(80, w - margin.left - margin.right)
  const innerH = props.height - margin.top - margin.bottom

  const svg = d3
    .select(el)
    .selectAll('svg')
    .data([null])
    .join('svg')
    .attr('width', w)
    .attr('height', props.height)

  const g = svg
    .selectAll('g.plot')
    .data([null])
    .join('g')
    .attr('class', 'plot')
    .attr('transform', `translate(${margin.left},${margin.top})`)

  // Categories, not time: the x axis is whatever the query grouped by, so the
  // points sit at even intervals in the order the board decided.
  const x = d3
    .scalePoint()
    .domain(rows.map((d) => d.label))
    .range([0, innerW])
    .padding(0.5)

  const y = d3
    .scaleLinear()
    .domain([0, d3.max(rows, (d) => d.value) || 1])
    .nice()
    .range([innerH, 0])

  g.selectAll('g.y-axis')
    .data([null])
    .join('g')
    .attr('class', 'y-axis')
    .call(d3.axisLeft(y).ticks(4).tickSize(-innerW))
    .call((sel) => sel.select('.domain').remove())

  // Every label would collide on a crowded axis, so only every nth is kept.
  const step = Math.ceil(rows.length / Math.max(2, Math.floor(innerW / 64)))
  g.selectAll('g.x-axis')
    .data([null])
    .join('g')
    .attr('class', 'x-axis')
    .attr('transform', `translate(0,${innerH})`)
    .call(
      d3
        .axisBottom(x)
        .tickSize(0)
        .tickValues(x.domain().filter((_, i) => i % step === 0))
    )
    .call((sel) => sel.select('.domain').attr('stroke', 'var(--rule)'))
    .selectAll('text')
    .attr('transform', 'translate(-6,4) rotate(-28)')
    .attr('text-anchor', 'end')
    .text((d) => (String(d).length > 16 ? `${String(d).slice(0, 15)}…` : d))

  const line = d3
    .line()
    .x((d) => x(d.label))
    .y((d) => y(d.value))

  // A single group has no line to draw — the dot alone carries it.
  g.selectAll('path.series')
    .data(rows.length > 1 ? [rows] : [])
    .join('path')
    .attr('class', 'series')
    .attr('fill', 'none')
    .attr('stroke', props.color)
    .attr('stroke-width', 1.8)
    .attr('d', line)

  g.selectAll('circle.dot')
    .data(rows, (d) => d.label)
    .join('circle')
    .attr('class', 'dot')
    .attr('r', 3.2)
    .attr('fill', props.color)
    .attr('cx', (d) => x(d.label))
    .attr('cy', (d) => y(d.value))

  // Labelling every point turns dense series into noise; sparse ones read well.
  g.selectAll('text.value')
    .data(rows.length <= 12 ? rows : [], (d) => d.label)
    .join('text')
    .attr('class', 'value figure')
    .attr('text-anchor', 'middle')
    .attr('x', (d) => x(d.label))
    .attr('y', (d) => y(d.value) - 8)
    .text((d) => d.value)
})
</script>

<template>
  <div ref="host" class="chart"></div>
</template>

<style scoped>
.chart :deep(text) {
  font-size: 11.5px;
  fill: var(--slate);
}

.chart :deep(text.value) {
  font-family: var(--figure);
  font-size: 10.5px;
  fill: var(--ink);
}

.chart :deep(.y-axis line) {
  stroke: var(--rule);
}
</style>
