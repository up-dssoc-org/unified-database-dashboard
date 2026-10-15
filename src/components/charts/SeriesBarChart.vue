<script setup>
/**
 * Bar chart for one or more series, drawn horizontally or vertically.
 *
 * Horizontal: categories down the left, bars growing right, values at their
 * ends — the board's ranked bar chart. Vertical: categories along the bottom
 * against a gridded value axis, labels turned on their side when they no longer
 * fit under their bar.
 *
 * With several series each category is a cluster of bars, one per series, and
 * a legend is drawn underneath. A series missing from a category leaves its
 * slot in the cluster empty rather than closing up, so a colour is always in
 * the same place within a cluster. A single series draws in `colors[0]` and
 * needs no legend.
 */
import { computed, watchEffect } from 'vue'
import * as d3 from 'd3'
import { useChartSize, CHART_COLORS } from './useChartSize'

const props = defineProps({
  // [{ group: string, series: string, value: number }], categories in draw order
  data: { type: Array, required: true },
  /** Series in legend and colour order. Derived from `data` when omitted. */
  series: { type: Array, default: null },
  colors: { type: Array, default: () => CHART_COLORS },
  orientation: { type: String, default: 'horizontal' },
  /** Horizontal: the gutter the category labels sit in. */
  labelWidth: { type: Number, default: 150 },
  /** Vertical: height of the plot itself, axis labels excluded. */
  plotHeight: { type: Number, default: 220 },
})

const { host, width } = useChartSize()

const seriesNames = computed(() => props.series ?? [...new Set(props.data.map((d) => d.series))])

const colorOf = (name) => {
  const i = seriesNames.value.indexOf(name)
  return props.colors[(i < 0 ? 0 : i) % props.colors.length]
}

// Averages come back with a long tail of decimals; two places is plenty here.
const format = (value) => value.toLocaleString(undefined, { maximumFractionDigits: 2 })

/** Rough width of chart text, close enough to lay out by before drawing. */
const CHAR_PX = 6.6
const clip = (text, max) => (text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text)

const describe = (d) => `${d.group}${d.series ? ` · ${d.series}` : ''}: ${format(d.value)}`

watchEffect(() => {
  const el = host.value
  if (!el) return

  const rows = props.data
  const series = seriesNames.value
  const groups = [...new Set(rows.map((d) => d.group))]
  const max = d3.max(rows, (d) => d.value) || 1
  const draw = props.orientation === 'vertical' ? drawVertical : drawHorizontal

  draw(el, { rows, series, groups, max, w: width.value })
})

function plotOf(el, w, h, margin) {
  const svg = d3
    .select(el)
    .selectAll('svg')
    .data([null])
    .join('svg')
    .attr('width', w)
    .attr('height', h)

  // Keyed by orientation, so switching it starts from a clean plot rather than
  // tweening bars from one axis onto the other.
  return svg
    .selectAll('g.plot')
    .data([props.orientation], (d) => d)
    .join('g')
    .attr('class', 'plot')
    .attr('transform', `translate(${margin.left},${margin.top})`)
}

/** Bars, each carrying its figure in a tooltip for when the label is not drawn. */
function joinBars(g, rows) {
  return g
    .selectAll('rect.bar')
    .data(rows, (d) => `${d.group}|${d.series}`)
    .join((enter) => {
      const rect = enter.append('rect').attr('class', 'bar')
      rect.append('title')
      return rect
    })
    .attr('fill', (d) => colorOf(d.series))
    .call((rect) => rect.select('title').text(describe))
}

function drawHorizontal(el, { rows, series, groups, max, w }) {
  const clustered = series.length > 1
  const margin = { top: 4, right: 48, bottom: 0, left: props.labelWidth }
  const innerW = Math.max(60, w - margin.left - margin.right)
  // Room for every bar in a cluster, plus the gap that separates clusters.
  const step = Math.max(26, series.length * 17.7)
  const innerH = groups.length * step

  const g = plotOf(el, w, innerH + margin.top, margin)

  const x = d3.scaleLinear().domain([0, max]).range([0, innerW])
  const y0 = d3
    .scaleBand()
    .domain(groups)
    .range([0, innerH])
    .paddingInner(clustered ? 0.26 : 0.28)
    .paddingOuter(clustered ? 0.13 : 0.14)
  const y1 = d3
    .scaleBand()
    .domain(series)
    .range([0, y0.bandwidth()])
    .padding(clustered ? 0.08 : 0)

  const room = Math.floor((props.labelWidth - 12) / CHAR_PX)
  g.selectAll('text.cat')
    .data(groups, (d) => d)
    .join('text')
    .attr('class', 'cat')
    .attr('x', -10)
    .attr('y', (d) => y0(d) + y0.bandwidth() / 2)
    .attr('dy', '0.34em')
    .attr('text-anchor', 'end')
    // Setting the text clears the node, so the full label is re-added each draw.
    .text((d) => clip(d, room))
    .append('title')
    .text((d) => d)

  joinBars(g, rows)
    .attr('x', 0)
    .attr('y', (d) => y0(d.group) + y1(d.series))
    .attr('height', y1.bandwidth())
    .attr('width', (d, i, nodes) => nodes[i].getAttribute('width') ?? 0)
    .transition()
    .duration(320)
    .attr('width', (d) => Math.max(1, x(d.value)))

  g.selectAll('text.val')
    .data(rows, (d) => `${d.group}|${d.series}`)
    .join('text')
    .attr('class', 'val figure')
    .attr('x', (d) => x(d.value) + 6)
    .attr('y', (d) => y0(d.group) + y1(d.series) + y1.bandwidth() / 2)
    .attr('dy', '0.34em')
    .text((d) => format(d.value))
}

function drawVertical(el, { rows, series, groups, max, w }) {
  const clustered = series.length > 1
  const y = d3.scaleLinear().domain([0, max]).nice().range([props.plotHeight, 0])
  const ticks = y.ticks(4)
  const tickRoom = Math.max(...ticks.map((t) => format(t).length)) * CHAR_PX

  const margin = { top: 16, right: 8, bottom: 0, left: Math.max(28, tickRoom + 10) }
  const innerW = Math.max(80, w - margin.left - margin.right)
  const innerH = props.plotHeight

  const x0 = d3
    .scaleBand()
    .domain(groups)
    .range([0, innerW])
    .paddingInner(clustered ? 0.2 : 0.28)
    .paddingOuter(0.1)
  const x1 = d3
    .scaleBand()
    .domain(series)
    .range([0, x0.bandwidth()])
    .padding(clustered ? 0.08 : 0)

  // Labels lie flat while they fit under their category, and turn on their side
  // — cut at a readable length — once they do not.
  const longest = Math.max(0, ...groups.map((label) => label.length))
  const turned = longest * CHAR_PX > x0.step() - 4
  const labelChars = turned ? Math.min(longest, 24) : longest
  margin.bottom = turned ? Math.min(130, labelChars * CHAR_PX * Math.SQRT1_2 + 20) : 24

  const g = plotOf(el, w, margin.top + innerH + margin.bottom, margin)

  g.selectAll('g.y-axis')
    .data([null])
    .join('g')
    .attr('class', 'y-axis')
    .call(d3.axisLeft(y).tickValues(ticks).tickSize(-innerW).tickFormat(format))
    .call((axis) => axis.select('.domain').remove())

  g.selectAll('line.baseline')
    .data([null])
    .join('line')
    .attr('class', 'baseline')
    .attr('x1', 0)
    .attr('x2', innerW)
    .attr('y1', innerH)
    .attr('y2', innerH)

  g.selectAll('text.cat')
    .data(groups, (d) => d)
    .join('text')
    .attr('class', 'cat')
    .attr('transform', (d) => {
      const at = x0(d) + x0.bandwidth() / 2
      return turned ? `translate(${at},${innerH + 10}) rotate(-45)` : `translate(${at},${innerH + 16})`
    })
    .attr('text-anchor', turned ? 'end' : 'middle')
    .attr('dy', turned ? '0.34em' : null)
    .text((d) => clip(d, labelChars))
    .append('title')
    .text((d) => d)

  joinBars(g, rows)
    .attr('x', (d) => x0(d.group) + x1(d.series))
    .attr('width', x1.bandwidth())
    .attr('y', (d, i, nodes) => nodes[i].getAttribute('y') ?? innerH)
    .attr('height', (d, i, nodes) => nodes[i].getAttribute('height') ?? 0)
    .transition()
    .duration(320)
    .attr('y', (d) => y(d.value))
    .attr('height', (d) => Math.max(0, innerH - y(d.value)))

  // Figures over the bars only while a bar is wide enough to carry one; the
  // tooltip has them otherwise.
  const figureRoom = Math.max(...rows.map((d) => format(d.value).length), 0) * 6
  const showFigures = x1.bandwidth() >= figureRoom

  g.selectAll('text.val')
    .data(showFigures ? rows : [], (d) => `${d.group}|${d.series}`)
    .join('text')
    .attr('class', 'val figure')
    .attr('x', (d) => x0(d.group) + x1(d.series) + x1.bandwidth() / 2)
    .attr('y', (d) => y(d.value) - 5)
    .attr('text-anchor', 'middle')
    .text((d) => format(d.value))
}
</script>

<template>
  <div>
    <div ref="host" class="chart"></div>
    <ul v-if="seriesNames.length > 1" class="series-legend">
      <li v-for="name in seriesNames" :key="name">
        <span class="swatch" :style="{ background: colorOf(name) }"></span>
        <span class="name">{{ name }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.chart :deep(text) {
  font-size: 12px;
  fill: var(--ink);
}

.chart :deep(text.cat),
.chart :deep(.y-axis text) {
  fill: var(--slate);
}

.chart :deep(.y-axis text) {
  font-family: var(--figure);
  font-size: 10.5px;
}

.chart :deep(.y-axis line) {
  stroke: var(--rule);
}

.chart :deep(line.baseline) {
  stroke: var(--slate);
  stroke-opacity: 0.5;
}

.chart :deep(text.val) {
  font-family: var(--figure);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}

.series-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 1rem;
  list-style: none;
  margin: 0.6rem 0 0;
  padding: 0;
  font-size: 0.8rem;
  color: var(--ink);
}

.swatch {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: 0.4rem;
  border-radius: 1px;
}
</style>
