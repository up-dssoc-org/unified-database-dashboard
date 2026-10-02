<script setup>
/**
 * One data point on the analytics board.
 *
 * Presentational: the view owns the query and keeps each point's `loading`,
 * `error` and `data` on the entry itself, so this component only decides how
 * the answer is drawn and emits the intents the board acts on.
 *
 * Which visualizations are on offer follows from the point's dimensionality,
 * not from this card — a 1-dimensional answer is a single figure and has only
 * the data cell to be drawn as.
 */
import { computed, nextTick, ref } from 'vue'
import BarChart from '@/components/charts/BarChart.vue'
import DonutChart from '@/components/charts/DonutChart.vue'
import LineChart from '@/components/charts/LineChart.vue'
import { CHART_COLORS } from '@/components/charts/useChartSize'
import { describeSpec, fieldLabel, metricLabel } from '@/api/analyticsSchema'
import { dimensionOf, sortedForLine, toFigure, toRows, visualizationsFor } from './dataPoints'

const props = defineProps({
  /** A board entry: { id, name, spec, viz, loading, error, data, resolvedName }. */
  point: { type: Object, required: true },
  /** Position on the board, and how many points share it — drives the ordering controls. */
  index: { type: Number, required: true },
  total: { type: Number, required: true },
})

const emit = defineEmits([
  'update:viz',
  'rename',
  'edit',
  'move',
  'remove',
  'refresh',
  'dragstart',
  'dragend',
  'drop',
])

const dimension = computed(() => dimensionOf(props.point.spec))
const vizOptions = computed(() => visualizationsFor(dimension.value))

/** The name given on creation, else the one the API derived from the query. */
const title = computed(() => props.point.name || props.point.resolvedName || 'Data point')

/**
 * Renaming happens in place: the heading is swapped for an input, Enter and
 * blur commit, Escape abandons. Clearing the field is a real answer — it hands
 * the point back to the name the API derives from its query.
 */
const renaming = ref(false)
const draft = ref('')
const nameInput = ref(null)

async function startRename() {
  draft.value = props.point.name ?? ''
  renaming.value = true
  await nextTick()
  nameInput.value?.select()
}

function commitRename() {
  // Escape closes the input before the blur it causes reaches this, so an
  // abandoned rename is already out of edit mode by the time blur fires.
  if (!renaming.value) return
  renaming.value = false
  const next = draft.value.trim()
  if (next !== (props.point.name ?? '')) emit('rename', next)
}

function cancelRename() {
  renaming.value = false
}

const description = computed(() => describeSpec(props.point.spec))

/** What the figure in a data cell is counting or averaging. */
const figureCaption = computed(() => {
  const operation = props.point.spec?.metric?.operation ?? '$count'
  if (operation === '$count') return 'records'
  return `${metricLabel(operation)} · ${fieldLabel(props.point.spec, props.point.spec?.metric?.field)}`
})

const color = computed(() => CHART_COLORS[props.index % CHART_COLORS.length])

const figure = computed(() => toFigure(props.point.data))

const rows = computed(() => {
  const shaped = toRows(props.point.data)
  return props.point.viz === 'line' ? sortedForLine(shaped) : shaped
})

/** A 2-dimensional query that matched nothing has categories to draw, but none. */
const empty = computed(() => dimension.value === '2d' && !rows.value.length)

const hasData = computed(() => props.point.data !== null && props.point.data !== undefined)

/** Longest category label decides how much room the bar chart's gutter needs. */
const labelWidth = computed(() => {
  const longest = Math.max(0, ...rows.value.map((r) => r.label.length))
  return Math.min(190, Math.max(90, longest * 7))
})
</script>

<template>
  <section
    class="panel point"
    :class="`span-${point.viz}`"
    @dragover.prevent
    @drop.prevent="emit('drop')"
  >
    <header class="point-head">
      <div
        class="handle"
        draggable="true"
        :title="`Drag to reorder — currently ${index + 1} of ${total}`"
        aria-hidden="true"
        @dragstart="emit('dragstart')"
        @dragend="emit('dragend')"
      >
        <span class="material-symbols-outlined">drag_indicator</span>
      </div>

      <div class="titles">
        <!-- Hovering the name reveals the pencil that opens this input. -->
        <input
          v-if="renaming"
          ref="nameInput"
          v-model="draft"
          class="name-input"
          type="text"
          :placeholder="point.resolvedName || 'Data point'"
          :aria-label="`Name of ${title}`"
          @keydown.enter.prevent="commitRename"
          @keydown.esc.prevent="cancelRename"
          @blur="commitRename"
        />
        <h2 v-else class="name-line">
          <span class="name-text">{{ title }}</span>
          <button
            type="button"
            class="rename-btn"
            :aria-label="`Rename ${title}`"
            title="Rename"
            @click="startRename"
          >
            <span class="material-symbols-outlined">edit</span>
          </button>
        </h2>
        <p class="point-note">{{ description }}</p>
      </div>

      <div class="point-actions">
        <!-- A single-option switch is noise: the 1-dimensional case has one. -->
        <label v-if="vizOptions.length > 1" class="viz">
          <span class="sr-only">Visualization for {{ title }}</span>
          <select
            :value="point.viz"
            :disabled="point.loading"
            @change="emit('update:viz', $event.target.value)"
          >
            <option v-for="v in vizOptions" :key="v.value" :value="v.value">{{ v.label }}</option>
          </select>
        </label>

        <div class="order" role="group" :aria-label="`Order of ${title}`">
          <button
            type="button"
            class="icon-btn"
            :disabled="index === 0"
            :aria-label="`Move ${title} earlier`"
            @click="emit('move', -1)"
          >
            <span class="material-symbols-outlined">arrow_upward</span>
          </button>
          <span class="position figure">{{ index + 1 }}</span>
          <button
            type="button"
            class="icon-btn"
            :disabled="index === total - 1"
            :aria-label="`Move ${title} later`"
            @click="emit('move', 1)"
          >
            <span class="material-symbols-outlined">arrow_downward</span>
          </button>
        </div>

        <button
          type="button"
          class="icon-btn"
          :disabled="point.loading"
          :aria-label="`Edit the query behind ${title}`"
          title="Edit query"
          @click="emit('edit')"
        >
          <span class="material-symbols-outlined">tune</span>
        </button>

        <button
          type="button"
          class="icon-btn"
          :disabled="point.loading"
          :aria-label="`Refresh ${title}`"
          title="Refresh"
          @click="emit('refresh')"
        >
          <span class="material-symbols-outlined">refresh</span>
        </button>

        <button
          type="button"
          class="icon-btn danger"
          :aria-label="`Remove ${title}`"
          @click="emit('remove')"
        >
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    </header>

    <p v-if="point.loading" class="muted state">Running…</p>
    <p v-else-if="point.error" class="notice state" role="alert">{{ point.error }}</p>
    <p v-else-if="empty" class="muted state">No records matched this query.</p>

    <template v-else-if="hasData">
      <!-- 1-dimensional: the figure is the whole point. -->
      <div v-if="point.viz === 'cell'" class="cell">
        <p class="cell-figure figure">{{ figure.toLocaleString() }}</p>
        <p class="cell-caption">{{ figureCaption }}</p>
      </div>

      <BarChart
        v-else-if="point.viz === 'bar'"
        :data="rows"
        :color="color"
        :label-width="labelWidth"
      />

      <LineChart v-else-if="point.viz === 'line'" :data="rows" :color="color" />

      <DonutChart v-else-if="point.viz === 'pie'" :data="rows" center-label="total" />
    </template>
  </section>
</template>

<style scoped>
.point {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* A line is read left to right, so it takes the full width of the board. */
.span-line {
  grid-column: 1 / -1;
}

.point-head {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin-bottom: 0.9rem;
}

.handle {
  color: var(--rule);
  cursor: grab;
  display: flex;
  margin: 0.1rem -0.25rem 0 -0.4rem;
}

.handle:active {
  cursor: grabbing;
}

.point:hover .handle {
  color: var(--slate);
}

.titles {
  flex: 1;
  min-width: 0;
}

/* The name, with the pencil kept inline so revealing it shifts nothing. */
.name-line {
  display: flex;
  align-items: baseline;
  gap: 0.3rem;
  overflow-wrap: anywhere;
}

.rename-btn {
  background: none;
  border: none;
  border-radius: 2px;
  color: var(--slate);
  cursor: pointer;
  display: inline-flex;
  padding: 0.05rem;
  opacity: 0;
  transition: opacity 0.12s, color 0.12s;
}

.name-line:hover .rename-btn,
.rename-btn:focus-visible {
  opacity: 1;
}

.rename-btn:hover {
  color: var(--maroon);
}

.rename-btn .material-symbols-outlined {
  font-size: 1rem;
}

/* Sized to sit where the heading was, so committing a rename does not jump. */
.name-input {
  font-size: 1.05rem;
  font-weight: 600;
  letter-spacing: -0.015em;
  padding: 0.1rem 0.3rem;
  margin: -0.1rem 0;
}

.point-note {
  margin: 0.15rem 0 0;
  color: var(--slate);
  font-size: 0.78rem;
  overflow-wrap: anywhere;
}

.point-actions {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-shrink: 0;
}

.viz select {
  width: auto;
  padding: 0.25rem 0.4rem;
  font-size: 0.78rem;
}

.order {
  display: flex;
  align-items: center;
}

.position {
  font-size: 0.72rem;
  color: var(--slate);
  min-width: 1.1rem;
  text-align: center;
}

.icon-btn {
  background: none;
  border: 1px solid transparent;
  border-radius: 2px;
  color: var(--slate);
  cursor: pointer;
  display: flex;
  align-items: center;
  padding: 0.2rem;
  transition: background 0.12s, color 0.12s;
}

.icon-btn:hover:not(:disabled) {
  background: var(--canvas);
  color: var(--ink);
}

.icon-btn.danger:hover:not(:disabled) {
  color: var(--maroon);
}

.icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.icon-btn .material-symbols-outlined {
  font-size: 1.05rem;
}

.state {
  margin: 0;
  font-size: 0.86rem;
}

/* The data cell: one figure, carried at headline size. */
.cell {
  padding: 0.4rem 0 0.6rem;
}

.cell-figure {
  margin: 0;
  font-size: 2.9rem;
  line-height: 1;
  font-weight: 500;
}

.cell-caption {
  margin: 0.35rem 0 0;
  color: var(--slate);
  font-size: 0.82rem;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
