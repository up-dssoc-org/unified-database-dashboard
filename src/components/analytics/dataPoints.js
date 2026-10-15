/**
 * What a data point on the analytics board is, and how the endpoint's answer is
 * turned into something the D3 charts accept.
 *
 * `POST /analytics` answers in one of two shapes, and which one it is follows
 * from the query alone: without `group_by` the `data` field is a single number,
 * with it the field is a list of subpoints, one per category. The board calls
 * the first case 1-dimensional and the second 2-dimensional, and the
 * visualizations each case allows are declared below.
 *
 * Any point can also be a comparison: the same query run once per series, each
 * series narrowing it with filters of its own (AY2425A against AY2425B, say),
 * and the answers drawn as one bar chart — a bar per series when the point is a
 * single figure, clustered bars over shared categories when it is broken down.
 * Comparisons are built in the query builder itself; the series live on the
 * point, so they persist and refresh exactly as a single query does.
 */
import { CHART_COLORS } from '@/components/charts/useChartSize'
import { intersect } from './filters'

/** Hard cap from the use case — a board holds ten points at most. */
export const MAX_DATA_POINTS = 10

/** One colour per series; past the palette, two series would share one. */
export const MAX_SERIES = CHART_COLORS.length
export const MIN_SERIES = 2

export const VISUALIZATIONS = [
  { value: 'cell', label: 'Data cell', dimension: '1d', note: 'A single figure.' },
  { value: 'bar', label: 'Bar chart', dimension: '2d', note: 'Ranked categories.' },
  { value: 'line', label: 'Line graph', dimension: '2d', note: 'Ordered categories.' },
  { value: 'pie', label: 'Pie chart', dimension: '2d', note: 'Shares of a whole.' },
]

/** Which way a bar chart's bars run. Horizontal keeps long category labels readable. */
export const ORIENTATIONS = [
  { value: 'horizontal', label: 'Horizontal', icon: 'align_horizontal_left' },
  { value: 'vertical', label: 'Vertical', icon: 'bar_chart' },
]

export const DEFAULT_ORIENTATION = 'horizontal'

export const coerceOrientation = (value) =>
  ORIENTATIONS.some((o) => o.value === value) ? value : DEFAULT_ORIENTATION

/**
 * Visualizations available to a query of the given dimensionality. A
 * comparison is always a bar chart: it is the one chart here that reads several
 * series against each other.
 */
export const visualizationsFor = (dimension, compared = false) =>
  VISUALIZATIONS.filter((v) => (compared ? v.value === 'bar' : v.dimension === dimension))

/** A query carrying `group_by` is the 2-dimensional case. */
export const dimensionOf = (spec) => (spec?.group_by ? '2d' : '1d')

export const visualizationLabel = (value) =>
  VISUALIZATIONS.find((v) => v.value === value)?.label ?? value ?? ''

/** Falls back to the first visualization the point allows. */
export function defaultVisualization(dimension, compared = false) {
  return visualizationsFor(dimension, compared)[0]?.value ?? 'cell'
}

/** Keeps a stored point from rendering as a chart its data cannot fill. */
export function coerceVisualization(viz, dimension, compared = false) {
  const allowed = visualizationsFor(dimension, compared)
  return allowed.some((v) => v.value === viz) ? viz : defaultVisualization(dimension, compared)
}

const asNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)

/**
 * The 1-dimensional answer. The endpoint already turns an empty result set and
 * a null aggregate into 0, so anything non-numeric here is a shape surprise
 * rather than a legitimate blank.
 */
export const toFigure = (data) => (typeof data === 'number' ? data : asNumber(data))

/**
 * The 2-dimensional answer, as `[{ label, value }]` — the shape every chart in
 * `components/charts` takes.
 *
 * A null `series_x_value` is an answer in itself: it is the bucket of documents
 * whose grouped field is null or missing, so it is labelled rather than dropped.
 */
export function toRows(data) {
  const subpoints = Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : []
  return subpoints.map((point) => {
    const x = point?.series_x_value
    const blank = x === null || x === undefined || x === ''
    return {
      label: blank ? 'Not recorded' : String(x),
      value: asNumber(point?.series_y_value),
    }
  })
}

/**
 * Re-sorts rows for a line graph. The endpoint returns groups by descending
 * value, which reads as a ranking on a bar chart but makes a line meaningless —
 * a line is read left to right, so its categories go in their own order.
 */
export function sortedForLine(rows) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  return [...rows].sort((a, b) => collator.compare(a.label, b.label))
}

/** A point with series is a comparison; one with fewer than two is a single query. */
export const isComparison = (point) => (point?.series?.length ?? 0) >= MIN_SERIES

/** A comparison with no name of its own reads as its series, side by side. */
export const comparisonName = (series) => series.map((s) => s.name).join(' vs. ')

/**
 * The query one series runs: the point's own, narrowed by the series' filters.
 * The point's `name` is left out so each answer is labelled by the series.
 */
export function seriesSpec(spec, series) {
  const { name, filters, any_of, ...base } = spec
  return { ...base, ...intersect(spec, series) }
}

/**
 * A comparison's answers as the `[{ group, series, value }]` rows the bar chart
 * takes, `answers` lining up with `series`, one endpoint answer each.
 *
 * Compared figures (1-dimensional) are one bar per series, so the series are
 * the categories. Compared breakdowns are clustered: see `toGroupedRows`.
 */
export function toComparisonRows(spec, series, answers) {
  if (dimensionOf(spec) === '1d') {
    return series.map((s, i) => ({ group: s.name, series: '', value: toFigure(answers?.[i]) }))
  }
  return toGroupedRows(series, answers)
}

/**
 * Compared breakdowns, one row per category per series.
 *
 * Each series is cut at its own top-N, so a category can be missing from some
 * of them. That is left as a gap rather than drawn as 0: it may well be a value
 * that simply fell below the cut. Categories run largest first by their
 * combined total, keeping the ranking a single bar chart reads as.
 */
export function toGroupedRows(series, answers) {
  const totals = new Map()
  const rows = []
  series.forEach((s, i) => {
    for (const { label, value } of toRows(answers?.[i])) {
      rows.push({ group: label, series: s.name, value })
      totals.set(label, (totals.get(label) ?? 0) + value)
    }
  })
  const order = [...totals.keys()].sort((a, b) => totals.get(b) - totals.get(a))
  const rank = new Map(order.map((group, i) => [group, i]))
  return rows.sort((a, b) => rank.get(a.group) - rank.get(b.group))
}
