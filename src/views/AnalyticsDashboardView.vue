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
 * The board itself is the state worth keeping — the figures are not. Only the
 * queries, their names and the chosen visualizations are persisted (to
 * sessionStorage, alongside the session that authorises them); the numbers are
 * re-fetched on load so a point never shows a stale figure.
 */
import { computed, inject, onMounted, reactive, ref } from 'vue'
import posthog from 'posthog-js'
import { api } from '@/api/client'
import { auth } from '@/stores/auth'
import DeleteModal from '@/components/generic/DeleteModal.vue'
import { toast } from '@/components/generic/useToast'
import DataPointBuilder from '@/components/analytics/DataPointBuilder.vue'
import DataPointCard from '@/components/analytics/DataPointCard.vue'
import {
  MAX_DATA_POINTS,
  coerceVisualization,
  dimensionOf,
} from '@/components/analytics/dataPoints'

const isPostHogConfigured = inject('isPostHogConfigured', false)

const STORAGE_KEY = 'dssoc.analytics.board'

/** Board entries, in display order. See `restore` for the persisted shape. */
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

const canRead = computed(() => auth.can('read:all', 'read:analytics'))
const atCapacity = computed(() => points.length >= MAX_DATA_POINTS)
const remaining = computed(() => MAX_DATA_POINTS - points.length)

let nextId = 1

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
    points.push({
      id: nextId++,
      name: typeof entry.name === 'string' ? entry.name : '',
      spec: entry.spec,
      // A stored visualization can outlive the query it belonged to only if it
      // still suits its dimensionality.
      viz: coerceVisualization(entry.viz, dimensionOf(entry.spec)),
      resolvedName: '',
      loading: false,
      error: '',
      data: null,
    })
  }
}

function persist() {
  const board = points.map(({ name, spec, viz }) => ({ name, spec, viz }))
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(board))
  } catch {
    // A full or blocked store costs the board its persistence, nothing more.
  }
}

/** Runs one point's query and writes the answer onto the entry. */
async function run(point) {
  point.loading = true
  point.error = ''
  try {
    const result = await api.fetchAnalysis(point.spec)
    point.data = result.data
    point.resolvedName = result.name ?? ''
  } catch (e) {
    point.data = null
    point.error = e?.detail || 'Could not run this query.'
  } finally {
    point.loading = false
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
async function addPoint({ name, spec, viz }) {
  if (atCapacity.value) return

  running.value = true
  buildError.value = ''
  try {
    const result = await api.fetchAnalysis(spec)
    points.push({
      id: nextId++,
      name,
      spec,
      viz,
      resolvedName: result.name ?? '',
      loading: false,
      error: '',
      data: result.data,
    })
    persist()
    if (isPostHogConfigured) {
      posthog.capture('analytics_data_point_created', {
        dimension: dimensionOf(spec),
        visualization: viz,
        collection: spec.collection,
        metric: spec.metric?.operation,
        joined: Boolean(spec.join),
        filter_count: spec.filters?.length ?? 0,
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
  point.viz = coerceVisualization(viz, dimensionOf(point.spec))
  persist()
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
async function savePoint({ name, spec, viz }) {
  const point = editTarget.value
  if (!point) return

  saving.value = true
  editError.value = ''
  try {
    const result = await api.fetchAnalysis(spec)
    point.name = name
    point.spec = spec
    point.viz = coerceVisualization(viz, dimensionOf(spec))
    point.resolvedName = result.name ?? ''
    point.data = result.data
    point.error = ''
    persist()
    if (isPostHogConfigured) {
      posthog.capture('analytics_data_point_edited', {
        dimension: dimensionOf(spec),
        visualization: point.viz,
        collection: spec.collection,
        metric: spec.metric?.operation,
        joined: Boolean(spec.join),
        filter_count: spec.filters?.length ?? 0,
      })
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
        chart, a line graph or a pie chart.
      </p>
      <button class="btn" @click="openBuilder">
        <span class="material-symbols-outlined">add</span>
        Add the first data point
      </button>
    </section>

    <div v-else class="board">
      <DataPointCard
        v-for="(point, index) in points"
        :key="point.id"
        :point="point"
        :index="index"
        :total="points.length"
        @update:viz="setViz(point, $event)"
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
