<script setup>
/**
 * Dialog that composes one analytics query.
 *
 * The form is a direct expression of what `POST /analytics` accepts, so every
 * control is bounded by the mirrored whitelist in `@/api/analyticsSchema` and a
 * submitted query is valid by construction. The first choice made is how many
 * dimensions the point has, because it decides both the rest of the form and
 * the visualizations the point can be drawn as:
 *
 *   1-dimensional — no `group_by`; the answer is one figure, drawn as a cell.
 *   2-dimensional — `group_by` set; the answer is one value per category,
 *                   drawn as a bar chart, a line graph or a pie chart.
 *
 * Filters are joined by AND or OR (see `FilterList`). Turning on Compare makes
 * the point a comparison: the query is run once per series, each series adding
 * filters of its own, and the answers are drawn together as one bar chart.
 *
 * Passing `values` puts the dialog in edit mode: the form opens from that
 * point's query and the wording switches to editing. The payload is identical
 * either way, so the caller hands it to an add or to a replacement without
 * telling the two apart.
 *
 * The caller owns the request: `submit` fires with
 * `{ name, spec, viz, orientation, series }` and the dialog stays open so the
 * caller can drive `busy` while the query runs and surface `error` in place if
 * it fails. The caller closes it by dropping the `v-if` once the point lands on
 * the board.
 *
 * This is deliberately not an `AddEditModal`: that modal's schema is a flat
 * list of independent fields built once on open, whereas this one has
 * repeating filter and series lists and selects whose options depend on
 * earlier answers.
 */
import { computed, onMounted, onUnmounted, reactive, ref, useId, watch } from 'vue'
import {
  COLLECTIONS,
  DEFAULT_GROUPS,
  JOIN_ALIAS,
  MAX_GROUPS,
  METRICS,
  MIN_GROUPS,
  addressableFields,
  collectionLabel,
  fieldsOf,
} from '@/api/analyticsSchema'
import { CHART_COLORS } from '@/components/charts/useChartSize'
import FilterList from './FilterList.vue'
import { intersect, queryFromRows, rowsFromQuery, rowsProblem, sizeProblem } from './filters'
import {
  MAX_SERIES,
  MIN_SERIES,
  ORIENTATIONS,
  coerceOrientation,
  coerceVisualization,
  comparisonName,
  defaultVisualization,
  dimensionOf,
  visualizationsFor,
} from './dataPoints'

const props = defineProps({
  /**
   * Existing board entry to edit — `{ name, spec, viz, orientation, series }`.
   * Its presence is what puts the dialog in edit mode; omit it to create.
   */
  values: { type: Object, default: null },
  /** Disables the form and shows progress while the caller's query runs. */
  busy: { type: Boolean, default: false },
  /** Message from a failed query, rendered above the buttons. */
  error: { type: String, default: '' },
})

const emit = defineEmits(['close', 'submit'])

const editing = computed(() => props.values !== null)

const uid = useId()
const fieldId = (key) => `${uid}-${key}`
const panel = ref(null)

let nextSeriesKey = 1

const blankSeries = () => ({ key: nextSeriesKey++, name: '', filters: [] })

/**
 * Built once, from the point being edited when there is one. The watchers below
 * only react to later changes, so seeding this way opens an edit on exactly the
 * query that was stored rather than tripping their reset behaviour.
 */
const source = props.values?.spec ?? null
const seededDimension = dimensionOf(source)
const seededSeries = (props.values?.series ?? []).map((s) => ({
  key: nextSeriesKey++,
  name: s.name ?? '',
  filters: rowsFromQuery(s),
}))
const seededCompare = seededSeries.length >= MIN_SERIES

const form = reactive({
  name: props.values?.name ?? '',
  dimension: seededDimension,
  collection: source?.collection ?? 'fact_reaffiliation',
  joinEnabled: Boolean(source?.join),
  joinCollection: source?.join?.collection ?? '',
  joinLocalField: source?.join?.local_field ?? '',
  joinForeignField: source?.join?.foreign_field ?? '_id',
  metricOperation: source?.metric?.operation ?? '$count',
  metricField: source?.metric?.field ?? '',
  groupBy: source?.group_by ?? '',
  limit: source?.limit ?? DEFAULT_GROUPS,
  includeDeleted: Boolean(source?.include_deleted),
  viz: coerceVisualization(props.values?.viz, seededDimension, seededCompare),
  orientation: coerceOrientation(props.values?.orientation),
  filters: rowsFromQuery(source),
  compare: seededCompare,
  series: seededSeries,
})

/** Set on submit, cleared as soon as the offending control is touched. */
const formError = ref('')
const clearError = () => (formError.value = '')

const join = computed(() =>
  form.joinEnabled && form.joinCollection ? { collection: form.joinCollection } : null
)

/** Every path this query may address, the joined collection's included. */
const fieldOptions = computed(() => addressableFields(form.collection, join.value))

const localFieldOptions = computed(() => fieldsOf(form.collection))
const foreignFieldOptions = computed(() => fieldsOf(form.joinCollection))

const metric = computed(() => METRICS.find((m) => m.value === form.metricOperation))
const needsMetricField = computed(() => Boolean(metric.value?.needsField))

const vizOptions = computed(() => visualizationsFor(form.dimension, form.compare))

const twoDimensional = computed(() => form.dimension === '2d')

const canAddSeries = computed(() => form.series.length < MAX_SERIES)

/** Every filter list in the form: the point's own, then each series'. */
const allFilterLists = () => [form.filters, ...form.series.map((s) => s.filters)]

// The dimensionality decides which visualizations exist, so the current pick
// has to follow it rather than survive it.
watch(
  () => form.dimension,
  (dimension) => {
    form.viz = defaultVisualization(dimension, form.compare)
    if (dimension === '1d') form.groupBy = ''
    clearError()
  }
)

// A comparison is always a bar chart; leaving one hands the pick back to
// whatever the dimensionality defaults to.
watch(
  () => form.compare,
  (compare) => {
    form.viz = coerceVisualization(form.viz, form.dimension, compare)
    while (compare && form.series.length < MIN_SERIES) form.series.push(blankSeries())
    clearError()
  }
)

// Changing the source — or dropping the join — invalidates every path already
// chosen against the old one, so the dependent selections are dropped with it
// rather than left pointing at a field the endpoint would reject.
watch(
  () => form.collection,
  () => {
    form.metricField = ''
    form.groupBy = ''
    form.joinLocalField = ''
    for (const list of allFilterLists()) list.splice(0)
    clearError()
  }
)

watch(
  () => [form.joinEnabled, form.joinCollection],
  () => {
    const stale = (path) => path.startsWith(`${JOIN_ALIAS}.`)
    if (stale(form.metricField)) form.metricField = ''
    if (stale(form.groupBy)) form.groupBy = ''
    for (const list of allFilterLists()) {
      for (const filter of list) {
        if (stale(filter.field)) filter.field = ''
      }
    }
    if (!form.joinEnabled) {
      form.joinCollection = ''
      form.joinLocalField = ''
      form.joinForeignField = '_id'
    }
    clearError()
  }
)

function addSeries() {
  if (!canAddSeries.value) return
  form.series.push(blankSeries())
  clearError()
}

function removeSeries(index) {
  form.series.splice(index, 1)
  clearError()
}

function moveSeries(index, delta) {
  const target = index + delta
  if (target < 0 || target >= form.series.length) return
  form.series.splice(target, 0, ...form.series.splice(index, 1))
}

const seriesPlaceholder = (index) => ['AY2425A', 'AY2425B', 'AY2526A', 'AY2526B'][index] ?? ''

const namePlaceholder = computed(() =>
  form.compare
    ? comparisonName(form.series.map((s, i) => ({ name: s.name.trim() || seriesPlaceholder(i) || '…' })))
    : 'Fellows this semester'
)

/** Returns the first problem with the form, or '' when it is ready to send. */
function problem() {
  if (!form.collection) return 'Choose a data source.'

  if (form.joinEnabled) {
    if (!form.joinCollection) return 'Choose the collection to join, or turn the join off.'
    if (!form.joinLocalField) return 'Choose the field on the data source that the join matches on.'
    if (!form.joinForeignField) return 'Choose the field on the joined collection to match against.'
  }

  if (needsMetricField.value && !form.metricField) {
    return `${metric.value.label.replace(/ of$/, '')} needs a field to aggregate.`
  }

  if (twoDimensional.value && !form.groupBy) {
    return 'A 2-dimensional point needs a field to break the measure down by.'
  }

  const limit = Number(form.limit)
  if (twoDimensional.value && (!Number.isInteger(limit) || limit < MIN_GROUPS || limit > MAX_GROUPS)) {
    return `Maximum categories must be a whole number between ${MIN_GROUPS} and ${MAX_GROUPS}.`
  }

  const filterProblem = rowsProblem(form.filters)
  if (filterProblem) return filterProblem
  const own = queryFromRows(form.filters)
  const tooBig = sizeProblem(own)
  if (tooBig) return `The filters are more than one query takes: ${tooBig}.`

  if (form.compare) return seriesProblem(own)

  return ''
}

function seriesProblem(own) {
  if (form.series.length < MIN_SERIES) return `A comparison needs at least ${MIN_SERIES} series.`

  const seen = new Set()
  for (const [index, s] of form.series.entries()) {
    const label = s.name.trim()
    if (!label) return `Series ${index + 1} needs a label for the chart.`
    const folded = label.toLowerCase()
    if (seen.has(folded)) return `Two series are labelled “${label}” — the chart needs them apart.`
    seen.add(folded)

    const rowProblem = rowsProblem(s.filters, `${label} filter`)
    if (rowProblem) return rowProblem
    const tooBig = sizeProblem(intersect(own, queryFromRows(s.filters)))
    if (tooBig) return `${label}, with the filters above, is more than one query takes: ${tooBig}.`
  }
  return ''
}

/**
 * The request body. Keys the endpoint treats as absent are omitted rather than
 * nulled: `AnalyticsMetric` rejects a `field` alongside `$count`, and leaving
 * `name` out is what asks the API to derive one from the query itself.
 */
function buildSpec() {
  const spec = {
    collection: form.collection,
    metric: { operation: form.metricOperation },
    ...queryFromRows(form.filters),
    include_deleted: form.includeDeleted,
  }

  const name = form.name.trim()
  if (name) spec.name = name
  if (needsMetricField.value) spec.metric.field = form.metricField
  if (form.joinEnabled) {
    spec.join = {
      collection: form.joinCollection,
      local_field: form.joinLocalField,
      foreign_field: form.joinForeignField,
    }
  }
  if (twoDimensional.value) {
    spec.group_by = form.groupBy
    spec.limit = Number(form.limit)
  }

  return spec
}

function submit() {
  if (props.busy) return

  const message = problem()
  formError.value = message
  if (message) return

  emit('submit', {
    name: form.name.trim(),
    spec: buildSpec(),
    viz: form.viz,
    orientation: form.orientation,
    series: form.compare
      ? form.series.map((s) => ({ name: s.name.trim(), ...queryFromRows(s.filters) }))
      : [],
  })
}

// A form mid-request should not close under the user, so Escape, the overlay
// and the × are all ignored while `busy`.
function close() {
  if (!props.busy) emit('close')
}

function onKeydown(event) {
  if (event.key === 'Escape') close()
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  panel.value?.querySelector('input, select')?.focus()
})
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="close">
      <div
        ref="panel"
        class="modal-panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="`${uid}-title`"
      >
        <div class="modal-header">
          <div>
            <h3 :id="`${uid}-title`">{{ editing ? 'Edit data point' : 'Add data point' }}</h3>
            <p class="sub">
              {{
                editing
                  ? 'Rewrite the query behind this point. It is re-run on save.'
                  : 'One query against the gold layer, drawn on the board.'
              }}
            </p>
          </div>
          <button class="close-btn" aria-label="Close" :disabled="busy" @click="close">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <form class="modal-body" novalidate @submit.prevent="submit">
          <!-- Dimensions first: everything below depends on this answer. -->
          <fieldset class="group">
            <legend>Dimensions</legend>
            <div class="choices">
              <label class="choice" :class="{ picked: form.dimension === '1d' }">
                <input v-model="form.dimension" type="radio" value="1d" :disabled="busy" />
                <span>
                  <strong>1-dimensional</strong>
                  <em>A single figure, shown as a data cell.</em>
                </span>
              </label>
              <label class="choice" :class="{ picked: form.dimension === '2d' }">
                <input v-model="form.dimension" type="radio" value="2d" :disabled="busy" />
                <span>
                  <strong>2-dimensional</strong>
                  <em>A value per category, shown as a chart.</em>
                </span>
              </label>
            </div>
          </fieldset>

          <div class="field">
            <label :for="fieldId('name')">Name</label>
            <input
              :id="fieldId('name')"
              v-model="form.name"
              type="text"
              :placeholder="namePlaceholder"
              :disabled="busy"
            />
            <p class="hint">
              Optional. Left blank, the point is named
              {{ form.compare ? 'after its series' : 'by the API after the query' }}.
            </p>
          </div>

          <!-- What is being measured -->
          <fieldset class="group">
            <legend>Measure</legend>

            <div class="field">
              <label :for="fieldId('collection')">Data source</label>
              <select :id="fieldId('collection')" v-model="form.collection" :disabled="busy">
                <option v-for="c in COLLECTIONS" :key="c.value" :value="c.value">
                  {{ c.label }}
                </option>
              </select>
            </div>

            <div class="row">
              <div class="field">
                <label :for="fieldId('metric')">Statistic</label>
                <select :id="fieldId('metric')" v-model="form.metricOperation" :disabled="busy">
                  <option v-for="m in METRICS" :key="m.value" :value="m.value">{{ m.label }}</option>
                </select>
              </div>

              <div v-if="needsMetricField" class="field">
                <label :for="fieldId('metric-field')">Field to aggregate</label>
                <select :id="fieldId('metric-field')" v-model="form.metricField" :disabled="busy">
                  <option value="" disabled>Select one</option>
                  <option v-for="f in fieldOptions" :key="f.value" :value="f.value">
                    {{ f.label }}
                  </option>
                </select>
                <p class="hint">Non-numeric fields come back as zero.</p>
              </div>
            </div>

            <label class="check">
              <input v-model="form.includeDeleted" type="checkbox" :disabled="busy" />
              <span>Include soft-deleted records</span>
            </label>
          </fieldset>

          <!-- Optional second collection -->
          <fieldset class="group">
            <legend>Join</legend>

            <label class="check">
              <input v-model="form.joinEnabled" type="checkbox" :disabled="busy" />
              <span>Pull in a second collection</span>
            </label>

            <template v-if="form.joinEnabled">
              <div class="field">
                <label :for="fieldId('join-collection')">Collection to join</label>
                <select
                  :id="fieldId('join-collection')"
                  v-model="form.joinCollection"
                  :disabled="busy"
                >
                  <option value="" disabled>Select one</option>
                  <option
                    v-for="c in COLLECTIONS.filter((c) => c.value !== form.collection)"
                    :key="c.value"
                    :value="c.value"
                  >
                    {{ c.label }}
                  </option>
                </select>
              </div>

              <div class="row">
                <div class="field">
                  <label :for="fieldId('join-local')">
                    Field on {{ collectionLabel(form.collection) }}
                  </label>
                  <select :id="fieldId('join-local')" v-model="form.joinLocalField" :disabled="busy">
                    <option value="" disabled>Select one</option>
                    <option v-for="f in localFieldOptions" :key="f.value" :value="f.value">
                      {{ f.label }}
                    </option>
                  </select>
                </div>

                <div class="field">
                  <label :for="fieldId('join-foreign')">Matched against</label>
                  <select
                    :id="fieldId('join-foreign')"
                    v-model="form.joinForeignField"
                    :disabled="busy || !form.joinCollection"
                  >
                    <option value="" disabled>Select one</option>
                    <option v-for="f in foreignFieldOptions" :key="f.value" :value="f.value">
                      {{ f.label }}
                    </option>
                  </select>
                </div>
              </div>

              <p class="hint">
                Records without a match are kept, so a join never changes the base count on its own.
              </p>
            </template>
          </fieldset>

          <!-- The breakdown that makes the point 2-dimensional -->
          <fieldset v-if="twoDimensional" class="group">
            <legend>Break down by</legend>

            <div class="row">
              <div class="field">
                <label :for="fieldId('group-by')">Category field</label>
                <select :id="fieldId('group-by')" v-model="form.groupBy" :disabled="busy">
                  <option value="" disabled>Select one</option>
                  <option v-for="f in fieldOptions" :key="f.value" :value="f.value">
                    {{ f.label }}
                  </option>
                </select>
              </div>

              <div class="field narrow">
                <label :for="fieldId('limit')">Maximum categories</label>
                <input
                  :id="fieldId('limit')"
                  v-model="form.limit"
                  type="number"
                  :min="MIN_GROUPS"
                  :max="MAX_GROUPS"
                  step="1"
                  :disabled="busy"
                />
              </div>
            </div>
            <p class="hint">Largest categories first; the rest are cut at this count.</p>
          </fieldset>

          <!-- Filters -->
          <fieldset class="group">
            <legend>Filters</legend>
            <FilterList
              :filters="form.filters"
              :fields="fieldOptions"
              :busy="busy"
              empty-text="No filters — the measure covers every record in the source."
              @change="clearError"
            />
          </fieldset>

          <!-- Series: the same query, narrowed several ways and read side by side -->
          <fieldset class="group">
            <legend>Compare</legend>

            <label class="check">
              <input v-model="form.compare" type="checkbox" :disabled="busy" />
              <span>Compare series side by side</span>
            </label>
            <p class="hint flush">
              {{
                form.compare
                  ? `Each series is this query plus filters of its own, AND-ed with the filters above. ${
                      twoDimensional
                        ? 'Every category gets a bar per series.'
                        : 'Each series is drawn as one bar.'
                    }`
                  : 'Run this query once per series — one semester against another, say — and draw the answers as one bar chart.'
              }}
            </p>

            <template v-if="form.compare">
              <div v-for="(s, index) in form.series" :key="s.key" class="series">
                <div class="series-head">
                  <span
                    class="swatch"
                    :style="{ background: CHART_COLORS[index % CHART_COLORS.length] }"
                    aria-hidden="true"
                  ></span>

                  <div class="field">
                    <label class="sr-only" :for="fieldId(`series-${s.key}`)">
                      Label for series {{ index + 1 }}
                    </label>
                    <input
                      :id="fieldId(`series-${s.key}`)"
                      v-model="s.name"
                      type="text"
                      :placeholder="seriesPlaceholder(index) || `Series ${index + 1}`"
                      :disabled="busy"
                      @input="clearError"
                    />
                  </div>

                  <div class="series-actions">
                    <button
                      type="button"
                      class="icon-btn"
                      :disabled="busy || index === 0"
                      :aria-label="`Move series ${index + 1} earlier`"
                      @click="moveSeries(index, -1)"
                    >
                      <span class="material-symbols-outlined">arrow_upward</span>
                    </button>
                    <button
                      type="button"
                      class="icon-btn"
                      :disabled="busy || index === form.series.length - 1"
                      :aria-label="`Move series ${index + 1} later`"
                      @click="moveSeries(index, 1)"
                    >
                      <span class="material-symbols-outlined">arrow_downward</span>
                    </button>
                    <button
                      type="button"
                      class="icon-btn danger"
                      :disabled="busy || form.series.length <= MIN_SERIES"
                      :aria-label="`Remove series ${index + 1}`"
                      :title="
                        form.series.length <= MIN_SERIES
                          ? `A comparison needs at least ${MIN_SERIES} series`
                          : undefined
                      "
                      @click="removeSeries(index)"
                    >
                      <span class="material-symbols-outlined">close</span>
                    </button>
                  </div>
                </div>

                <FilterList
                  :filters="s.filters"
                  :fields="fieldOptions"
                  :busy="busy"
                  :subject="`${s.name.trim() || `Series ${index + 1}`} filter`"
                  empty-text="No filters of its own — this series is the query as it stands."
                  @change="clearError"
                />
              </div>

              <button
                type="button"
                class="btn btn-quiet add-series"
                :disabled="busy || !canAddSeries"
                @click="addSeries"
              >
                <span class="material-symbols-outlined">add</span>
                Add series
              </button>
              <p v-if="!canAddSeries" class="hint flush">
                {{ MAX_SERIES }} series is the most one chart can tell apart.
              </p>
            </template>
          </fieldset>

          <!-- How it is drawn -->
          <div class="row">
            <div class="field">
              <label :for="fieldId('viz')">Show as</label>
              <select :id="fieldId('viz')" v-model="form.viz" :disabled="busy || vizOptions.length < 2">
                <option v-for="v in vizOptions" :key="v.value" :value="v.value">
                  {{ v.label }} — {{ form.compare ? 'Series side by side.' : v.note }}
                </option>
              </select>
            </div>

            <div v-if="form.viz === 'bar'" class="field narrow">
              <label :for="fieldId('orientation')">Bars</label>
              <select :id="fieldId('orientation')" v-model="form.orientation" :disabled="busy">
                <option v-for="o in ORIENTATIONS" :key="o.value" :value="o.value">
                  {{ o.label }}
                </option>
              </select>
            </div>
          </div>
          <p class="hint flush">Changeable on the board once the point is there.</p>

          <p v-if="formError || error" class="notice" role="alert">{{ formError || error }}</p>

          <div class="modal-footer">
            <button type="button" class="btn btn-quiet" :disabled="busy" @click="close">
              Cancel
            </button>
            <button type="submit" class="btn" :disabled="busy">
              {{
                busy
                  ? editing
                    ? 'Saving…'
                    : 'Running…'
                  : editing
                    ? 'Save data point'
                    : 'Add data point'
              }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(22, 25, 26, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 500;
  padding: 1rem;
}

.modal-panel {
  background: var(--surface);
  border-radius: 0.5rem;
  border: 1px solid var(--rule);
  box-shadow: 0 8px 32px rgba(22, 25, 26, 0.18);
  width: 100%;
  max-width: 580px;
  max-height: 90vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.25rem 1.5rem 1rem;
  border-bottom: 1px solid var(--rule);
  position: sticky;
  top: 0;
  background: var(--surface);
  z-index: 1;
}

.modal-header h3 {
  margin: 0 0 0.2rem;
  font-size: 1rem;
}

.sub {
  margin: 0;
  font-size: 0.82rem;
  color: var(--slate);
}

.close-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.15rem;
  border-radius: 4px;
  color: var(--slate);
  display: flex;
  align-items: center;
  line-height: 1;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s;
}

.close-btn:hover:not(:disabled) {
  background: var(--rule);
  color: var(--ink);
}

.close-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.close-btn .material-symbols-outlined {
  font-size: 1.2rem;
}

.modal-body {
  padding: 1.25rem 1.5rem 0;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

/* Groups carry the same hairline treatment as a panel, one step quieter. */
.group {
  margin: 0;
  padding: 0.9rem 1rem 1rem;
  border: 1px solid var(--rule);
  border-radius: 2px;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.group legend {
  padding: 0 0.35rem;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--slate);
}

.row {
  display: flex;
  gap: 0.8rem;
  flex-wrap: wrap;
}

.row .field {
  flex: 1 1 12rem;
  min-width: 0;
}

.narrow {
  flex: 0 1 9rem;
}

.field label {
  margin-bottom: 0.35rem;
}

/* Dimension choice reads as two cards rather than two bare radios. */
.choices {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.choice {
  flex: 1 1 13rem;
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  margin: 0;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--rule);
  border-radius: 2px;
  cursor: pointer;
  color: var(--ink);
}

.choice.picked {
  border-color: var(--maroon);
  box-shadow: inset 2px 0 0 var(--maroon);
}

.choice input {
  width: auto;
  margin: 0.2rem 0 0;
  accent-color: var(--maroon);
}

.choice strong {
  display: block;
  font-size: 0.9rem;
  font-weight: 600;
}

.choice em {
  display: block;
  font-style: normal;
  font-size: 0.78rem;
  color: var(--slate);
}

.check {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-size: 0.9rem;
  color: var(--ink);
  cursor: pointer;
}

.check input {
  width: auto;
  margin: 0;
  accent-color: var(--maroon);
}

/* A series: its colour and label on top, its own filters underneath. */
.series {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  padding: 0.75rem 0.8rem 0.85rem;
  border: 1px dashed var(--rule);
  border-radius: 2px;
}

.series-head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 0.6rem;
  align-items: center;
}

.swatch {
  width: 10px;
  height: 10px;
  border-radius: 1px;
}

.series-actions {
  display: flex;
  align-items: center;
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

.add-series {
  align-self: flex-start;
  padding: 0.4rem 0.75rem;
  font-size: 0.85rem;
}

.add-series .material-symbols-outlined {
  font-size: 1.05rem;
}

/* Sits directly under the control it explains, so the container's gap does the spacing. */
.hint.flush {
  margin: 0;
}

/* The body's gap is undone for the note under "Show as". */
.modal-body > .hint.flush {
  margin-top: -0.75rem;
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

.hint {
  margin: 0.3rem 0 0;
  font-size: 0.8rem;
  color: var(--slate);
}

.notice {
  margin: 0;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  padding: 1rem 0;
  margin-top: 0.25rem;
  border-top: 1px solid var(--rule);
  background: var(--surface);
  position: sticky;
  bottom: 0;
}

</style>
