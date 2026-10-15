<script setup>
/**
 * The analytics board.
 *
 * Unlike `SummaryView`, which draws a fixed set of breakdowns from one
 * pre-aggregated response, this view is composed by the user: each data point
 * is its own query to `POST /analytics`, added through `DataPointBuilder` and
 * drawn by `DataPointCard`. Ten points is the cap, the order is the user's, and
 * the whole board can be cleared in one action.
 *
 * A point can also be a comparison, set up in the same builder: two or more
 * series, each the point's query narrowed by filters of its own, run side by
 * side and drawn as one bar chart. It takes a single slot on the board.
 *
 * The board itself is the state worth keeping — the figures are not. Only the
 * queries, their names and how they are drawn are persisted (to
 * sessionStorage, alongside the session that authorises them); the numbers are
 * re-fetched on load so a point never shows a stale figure.
 */
import { computed, inject, onMounted, reactive, ref } from 'vue'
import posthog from 'posthog-js'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import DeleteModal from '@/components/generic/DeleteModal.vue'
import { toast } from '@/components/generic/useToast'
import DataPointBuilder from '@/components/analytics/DataPointBuilder.vue'
import DataPointCard from '@/components/analytics/DataPointCard.vue'
import ExportBoardModal from '@/components/analytics/ExportBoardModal.vue'
import { exportBoard } from '@/components/analytics/boardExport'
import {
  MAX_DATA_POINTS,
  MAX_SERIES,
  MIN_SERIES,
  coerceOrientation,
  coerceVisualization,
  comparisonName,
  dimensionOf,
  isComparison,
  seriesSpec,
} from '@/components/analytics/dataPoints'

const isPostHogConfigured = inject('isPostHogConfigured', false)

const STORAGE_KEY = 'dssoc.analytics.board'

const auth = useAuthStore();

/** Board entries, in display order. See `shape` for the persisted part. */
const points = reactive([])

const building = ref(false)
const running = ref(false)
const buildError = ref('')
const clearing = ref(false)

// The point open in the builder for editing, plus the state the dialog renders
// while its re-run is in flight.
const editTarget = ref(null)
const saving = ref(false)
const editError = ref('')

/** Index the current drag started from, or null when nothing is being dragged. */
const dragFrom = ref(null)

// The export dialog, and the state it renders while the file is built. The
// board element is what gets exported, so it has to be on the page.
const boardEl = ref(null)
const exportOpen = ref(false)
const exporting = ref(false)
const exportError = ref('')

const canRead = computed(() => auth.can('read:all', 'read:analytics'))
const atCapacity = computed(() => points.length >= MAX_DATA_POINTS)
const remaining = computed(() => MAX_DATA_POINTS - points.length)

/** A point still running would be exported as "Running…", so export waits for it. */
const anyLoading = computed(() => points.some((point) => point.loading))

let nextId = 1

/**
 * A comparison's stored series, or none when they could not be drawn as one:
 * every series needs a label, and there must be enough of them to compare.
 */
function restoreSeries(stored) {
  if (!Array.isArray(stored)) return []
  const series = stored
    .slice(0, MAX_SERIES)
    .filter((s) => typeof s?.name === 'string' && s.name)
    .map(({ name, filters, any_of }) => ({
      name,
      filters: Array.isArray(filters) ? filters : [],
      ...(Array.isArray(any_of) && any_of.length ? { any_of } : {}),
    }))
  return series.length >= MIN_SERIES ? series : []
}

/**
 * The persisted part of a point, as the builder submits it. A visualization
 * can outlive the query it belonged to only if it still suits it.
 */
function shape({ name, spec, viz, orientation, series = [] }) {
  return {
    name: typeof name === 'string' ? name : '',
    spec,
    series,
    viz: coerceVisualization(viz, dimensionOf(spec), series.length >= MIN_SERIES),
    orientation: coerceOrientation(orientation),
  }
}

/** A point as the board holds it, before its query has run. */
function entryOf(payload) {
  return {
    id: nextId++,
    ...shape(payload),
    resolvedName: '',
    loading: false,
    error: '',
    data: null,
  }
}

/**
 * Rebuilds the board from sessionStorage. Anything malformed is dropped rather
 * than rendered: a stored point is only as good as the query inside it, and a
 * half-written entry would fail on every refresh.
 */
function restore() {
  let stored
  try {
    stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return
  }
  if (!Array.isArray(stored)) return

  for (const entry of stored.slice(0, MAX_DATA_POINTS)) {
    if (!entry?.spec?.collection) continue
    points.push(entryOf({ ...entry, series: restoreSeries(entry.series) }))
  }
}

function persist() {
  const board = points.map(({ name, spec, viz, orientation, series }) => ({
    name,
    spec,
    viz,
    orientation,
    series,
  }))
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(board))
  } catch {
    // A full or blocked store costs the board its persistence, nothing more.
  }
}

/**
 * Runs every series of a comparison side by side and resolves to their
 * answers, in series order. One failure fails the comparison — half of one
 * would read as a whole — and names the series that failed.
 */
async function fetchSeries(spec, series) {
  const results = await Promise.allSettled(
    series.map((s) => api.fetchAnalysis(seriesSpec(spec, s)))
  )
  const failed = results.findIndex((r) => r.status === 'rejected')
  if (failed >= 0) {
    const detail = `${series[failed].name}: ${results[failed].reason?.detail || 'Could not run this query.'}`
    throw Object.assign(new Error(detail), { detail })
  }
  return results.map((r) => r.value.data)
}

/** Runs a point's query — or each of its series' — and resolves to what the card draws. */
async function answer({ spec, series }) {
  if (series.length >= MIN_SERIES) {
    return { data: await fetchSeries(spec, series), resolvedName: comparisonName(series) }
  }
  const result = await api.fetchAnalysis(spec)
  return { data: result.data, resolvedName: result.name ?? '' }
}

/** Runs one point and writes the answer onto the entry. */
async function run(point) {
  point.loading = true
  point.error = ''
  try {
    Object.assign(point, await answer(point))
  } catch (e) {
    point.data = null
    point.error = e?.detail || 'Could not run this query.'
  } finally {
    point.loading = false
  }
}

/** What analytics learns about a query: its shape, never its values. */
function traits({ spec, series, viz, orientation }) {
  const anyOf = spec.any_of ?? []
  return {
    dimension: dimensionOf(spec),
    visualization: viz,
    orientation: viz === 'bar' ? orientation : null,
    collection: spec.collection,
    metric: spec.metric?.operation,
    joined: Boolean(spec.join),
    filter_count: (spec.filters?.length ?? 0) + anyOf.reduce((n, b) => n + b.length, 0),
    or_groups: anyOf.length,
    compared_series: series.length,
  }
}

onMounted(() => {
  restore()
  if (canRead.value) points.forEach(run)
})

function openBuilder() {
  if (atCapacity.value) return
  buildError.value = ''
  building.value = true
}

function closeBuilder() {
  building.value = false
  buildError.value = ''
}

/**
 * Runs the query before the point reaches the board, so a rejected one stays in
 * the builder with its answer — the typed query survives and can be corrected
 * rather than landing on the board as a broken tile.
 */
async function addPoint(payload) {
  if (atCapacity.value) return

  running.value = true
  buildError.value = ''
  try {
    const entry = entryOf(payload)
    Object.assign(entry, await answer(entry))
    points.push(entry)
    persist()
    if (isPostHogConfigured) {
      posthog.capture('analytics_data_point_created', {
        ...traits(entry),
        board_size: points.length,
      })
    }
    building.value = false
    toast.success('Data point added!')
  } catch (e) {
    buildError.value = e?.detail || 'Could not run this query.'
    toast.error('Failed to add data point')
  } finally {
    running.value = false
  }
}

function setViz(point, viz) {
  point.viz = coerceVisualization(viz, dimensionOf(point.spec), isComparison(point))
  persist()
}

function setOrientation(point, orientation) {
  point.orientation = coerceOrientation(orientation)
  persist()
  if (isPostHogConfigured) {
    posthog.capture('analytics_bar_orientation_changed', { orientation: point.orientation })
  }
}

function editPoint(point) {
  editError.value = ''
  editTarget.value = point
}

function cancelEdit() {
  editTarget.value = null
  editError.value = ''
}

/**
 * Replaces a point's query in place. The rewritten query is run before anything
 * on the board changes, so a point that already works is never traded for one
 * that does not — and the point keeps its identity and its position either way.
 */
async function savePoint(payload) {
  const point = editTarget.value
  if (!point) return

  saving.value = true
  editError.value = ''
  try {
    const next = shape(payload)
    const result = await answer(next)
    Object.assign(point, next, result, { error: '' })
    persist()
    if (isPostHogConfigured) {
      posthog.capture('analytics_data_point_edited', traits(point))
    }
    editTarget.value = null
    toast.success('Data point updated!')
  } catch (e) {
    // Kept in the dialog so the rewritten query survives and can be corrected.
    editError.value = e?.detail || 'Could not run this query.'
    toast.error('Failed to update data point')
  } finally {
    saving.value = false
  }
}

/**
 * Renaming touches the label alone — the query is untouched, so there is nothing
 * to re-run. An empty name hands the point back to the one the API derives.
 */
function renamePoint(point, name) {
  point.name = name
  persist()
  if (isPostHogConfigured) {
    posthog.capture('analytics_data_point_renamed', { cleared: !name })
  }
}

function removePoint(index) {
  points.splice(index, 1)
  persist()
  if (isPostHogConfigured) {
    posthog.capture('analytics_data_point_removed', { board_size: points.length })
  }
}

/** Moves a point one place earlier or later; the ends simply hold. */
function nudge(index, delta) {
  const target = index + delta
  if (target < 0 || target >= points.length) return
  points.splice(target, 0, ...points.splice(index, 1))
  persist()
}

/** Drop target for a dragged point — it takes that slot, the rest close up. */
function dropOn(index) {
  const from = dragFrom.value
  dragFrom.value = null
  if (from === null || from === index) return
  points.splice(index, 0, ...points.splice(from, 1))
  persist()
  if (isPostHogConfigured) posthog.capture('analytics_board_reordered')
}

function refreshAll() {
  points.forEach(run)
}

function openExport() {
  exportError.value = ''
  exportOpen.value = true
}

function closeExport() {
  exportOpen.value = false
  exportError.value = ''
}

async function exportPoints({ format, header }) {
  if (!boardEl.value) return

  exporting.value = true
  exportError.value = ''
  try {
    await exportBoard(boardEl.value, { format, header })
    if (isPostHogConfigured) {
      posthog.capture('analytics_board_exported', {
        format,
        header: Boolean(header),
        board_size: points.length,
      })
    }
    exportOpen.value = false
    toast.success(`Dashboard saved as ${format.toUpperCase()}!`)
  } catch (e) {
    exportError.value = e?.message || 'Could not export the dashboard.'
    toast.error('Failed to export dashboard')
  } finally {
    exporting.value = false
  }
}

function confirmClear() {
  const cleared = points.length
  points.splice(0)
  persist()
  clearing.value = false
  if (isPostHogConfigured) posthog.capture('analytics_board_cleared', { cleared })
  toast.warning('Dashboard cleared!')
}
</script>

<template>
  <header class="head">
    <div>
      <h1>Analytics dashboard</h1>
      <p class="muted sub">
        Your own data points, up to {{ MAX_DATA_POINTS }}, in the order you put them.
      </p>
    </div>
    <div class="controls">
      <button
        v-if="points.length"
        class="btn btn-quiet"
        :disabled="!canRead"
        @click="refreshAll"
      >
        <span class="material-symbols-outlined">refresh</span>
        Refresh all
      </button>
      <button
        v-if="points.length"
        class="btn btn-quiet"
        :disabled="!canRead || anyLoading"
        :title="anyLoading ? 'Wait for every data point to finish running' : undefined"
        @click="openExport"
      >
        <span class="material-symbols-outlined">download</span>
        Export
      </button>
      <button
        v-if="points.length"
        class="btn btn-quiet"
        @click="clearing = true"
      >
        <span class="material-symbols-outlined">delete_sweep</span>
        Clear dashboard
      </button>
      <button class="btn" :disabled="!canRead || atCapacity" @click="openBuilder">
        <span class="material-symbols-outlined">add</span>
        Add data point
      </button>
    </div>
  </header>

  <p v-if="!canRead" class="notice" role="alert">
    Your account needs read:analytics or read:all to build data points.
  </p>

  <template v-else>
    <p class="count">
      <span class="figure">{{ points.length }}</span> of
      <span class="figure">{{ MAX_DATA_POINTS }}</span> data points<span v-if="atCapacity">
        · the board is full, remove one to add another</span
      >
    </p>

    <!-- Empty board: the one thing to do here is add the first point. -->
    <section v-if="!points.length" class="panel blank">
      <h2>Nothing on the board yet</h2>
      <p class="panel-note">
        A data point is one query. Ask for a single figure — a count, an average — and it is drawn
        as a data cell; break that figure down by a second field and it can be drawn as a bar
        chart, a line graph or a pie chart. Filters can be joined by AND or OR, and turning on
        Compare runs the same query for several series — one semester against another, say — and
        draws them as one bar chart.
      </p>
      <button class="btn" @click="openBuilder">
        <span class="material-symbols-outlined">add</span>
        Add the first data point
      </button>
    </section>

    <div v-else ref="boardEl" class="board">
      <DataPointCard
        v-for="(point, index) in points"
        :key="point.id"
        :point="point"
        :index="index"
        :total="points.length"
        @update:viz="setViz(point, $event)"
        @update:orientation="setOrientation(point, $event)"
        @rename="renamePoint(point, $event)"
        @edit="editPoint(point)"
        @move="nudge(index, $event)"
        @remove="removePoint(index)"
        @refresh="run(point)"
        @dragstart="dragFrom = index"
        @dragend="dragFrom = null"
        @drop="dropOn(index)"
      />
    </div>

    <p v-if="points.length && !atCapacity" class="muted room">
      Room for {{ remaining }} more.
    </p>
  </template>

  <DataPointBuilder
    v-if="building"
    :busy="running"
    :error="buildError"
    @close="closeBuilder"
    @submit="addPoint"
  />

  <DataPointBuilder
    v-if="editTarget"
    :values="editTarget"
    :busy="saving"
    :error="editError"
    @close="cancelEdit"
    @submit="savePoint"
  />

  <ExportBoardModal
    v-if="exportOpen"
    :count="points.length"
    :busy="exporting"
    :error="exportError"
    @close="closeExport"
    @submit="exportPoints"
  />

  <DeleteModal
    v-if="clearing"
    title="Clear dashboard"
    confirm-label="Clear dashboard"
    @close="clearing = false"
    @confirm="confirmClear"
  >
    Remove all <strong>{{ points.length }}</strong> data points from the board? The queries behind
    them are not saved anywhere else, so they would have to be built again.
  </DeleteModal>
</template>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 1.5rem;
  flex-wrap: wrap;
  padding-bottom: 1.1rem;
  margin-bottom: 1.2rem;
  border-bottom: 1px solid var(--rule);
}

.sub {
  margin: 0.2rem 0 0;
  font-size: 0.9rem;
}

.controls {
  display: flex;
  gap: 0.6rem;
  align-items: flex-end;
  flex-wrap: wrap;
}

.controls .material-symbols-outlined {
  font-size: 1.1rem;
}

.count {
  margin: 0 0 0.8rem;
  color: var(--slate);
  font-size: 0.9rem;
}

.count .figure {
  color: var(--ink);
  font-size: 1rem;
}

.board {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  align-items: start;
}

.blank {
  max-width: 34rem;
}

.blank h2 {
  margin-bottom: 0.15rem;
}

.room {
  margin: 1rem 0 0;
  font-size: 0.85rem;
}

@media (max-width: 900px) {
  .board {
    grid-template-columns: 1fr;
  }
}
</style>
