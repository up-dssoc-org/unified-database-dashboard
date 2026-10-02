/**
 * What a data point on the analytics board is, and how the endpoint's answer is
 * turned into something the D3 charts accept.
 *
 * `POST /analytics` answers in one of two shapes, and which one it is follows
 * from the query alone: without `group_by` the `data` field is a single number,
 * with it the field is a list of subpoints, one per category. The board calls
 * the first case 1-dimensional and the second 2-dimensional, and the
 * visualizations each case allows are declared below.
 */

/** Hard cap from the use case — a board holds ten points at most. */
export const MAX_DATA_POINTS = 10

export const VISUALIZATIONS = [
  { value: 'cell', label: 'Data cell', dimension: '1d', note: 'A single figure.' },
  { value: 'bar', label: 'Bar chart', dimension: '2d', note: 'Ranked categories.' },
  { value: 'line', label: 'Line graph', dimension: '2d', note: 'Ordered categories.' },
  { value: 'pie', label: 'Pie chart', dimension: '2d', note: 'Shares of a whole.' },
]

/** Visualizations available to a query of the given dimensionality. */
export const visualizationsFor = (dimension) =>
  VISUALIZATIONS.filter((v) => v.dimension === dimension)

/** A query carrying `group_by` is the 2-dimensional case. */
export const dimensionOf = (spec) => (spec?.group_by ? '2d' : '1d')

export const visualizationLabel = (value) =>
  VISUALIZATIONS.find((v) => v.value === value)?.label ?? value ?? ''

/** Falls back to the first visualization the dimensionality allows. */
export function defaultVisualization(dimension) {
  return visualizationsFor(dimension)[0]?.value ?? 'cell'
}

/** Keeps a stored point from rendering as a chart its data cannot fill. */
export function coerceVisualization(viz, dimension) {
  const allowed = visualizationsFor(dimension)
  return allowed.some((v) => v.value === viz) ? viz : defaultVisualization(dimension)
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
