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
 * Passing `values` puts the dialog in edit mode: the form opens from that
 * point's query and the wording switches to editing. The payload is identical
 * either way, so the caller hands it to an add or to a replacement without
 * telling the two apart.
 *
 * The caller owns the request: `submit` fires with `{ name, spec, viz }` and the
 * dialog stays open so the caller can drive `busy` while the query runs and
 * surface `error` in place if it fails. The caller closes it by dropping the
 * `v-if` once the point lands on the board.
 *
 * This is deliberately not an `AddEditModal`: that modal's schema is a flat
 * list of independent fields built once on open, whereas this one has a
 * repeating filter list and selects whose options depend on earlier answers.
 */
import { computed, onMounted, onUnmounted, reactive, ref, useId, watch } from 'vue'
import {
  COLLECTIONS,
  DEFAULT_GROUPS,
  JOIN_ALIAS,
  LIST_OPERATORS,
  MAX_FILTERS,
  MAX_GROUPS,
  METRICS,
  MIN_GROUPS,
  NULL_OPERATORS,
  OPERATORS,
  addressableFields,
  collectionLabel,
  fieldsOf,
} from '@/api/analyticsSchema'
import { defaultVisualization, dimensionOf, visualizationsFor } from './dataPoints'

const props = defineProps({
  /**
   * Existing board entry to edit — `{ name, spec, viz }`. Its presence is what
   * puts the dialog in edit mode; omit it to create.
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

/**
 * Filter values are text in the form and typed in the query, so an edit has to
 * bring them back the other way: a list joins into the comma-separated text the
 * field accepts, and a null operator's absent value stays absent.
 */
function seedFilters(spec) {
  return (spec?.filters ?? []).map((filter) => {
    const operator = filter?.operator ?? '$eq'
    let value = ''
    if (!NULL_OPERATORS.has(operator)) {
      if (Array.isArray(filter?.value)) value = filter.value.join(', ')
      else if (filter?.value !== null && filter?.value !== undefined) value = String(filter.value)
    }
    return { field: filter?.field ?? '', operator, value }
  })
}

/**
 * Built once, from the point being edited when there is one. The watchers below
 * only react to later changes, so seeding this way opens an edit on exactly the
 * query that was stored rather than tripping their reset behaviour.
 */
const source = props.values?.spec ?? null
const seededDimension = dimensionOf(source)

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
  viz: props.values?.viz ?? defaultVisualization(seededDimension),
  filters: seedFilters(source),
})

/** Set on submit, cleared as soon as the offending control is touched. */
const formError = ref('')

const join = computed(() =>
  form.joinEnabled && form.joinCollection ? { collection: form.joinCollection } : null
)

/** Every path this query may address, the joined collection's included. */
const fieldOptions = computed(() => addressableFields(form.collection, join.value))

const localFieldOptions = computed(() => fieldsOf(form.collection))
const foreignFieldOptions = computed(() => fieldsOf(form.joinCollection))

const metric = computed(() => METRICS.find((m) => m.value === form.metricOperation))
const needsMetricField = computed(() => Boolean(metric.value?.needsField))

const vizOptions = computed(() => visualizationsFor(form.dimension))

const twoDimensional = computed(() => form.dimension === '2d')

const canAddFilter = computed(() => form.filters.length < MAX_FILTERS)

/** A value input is hidden for the null operators and plural for the list ones. */
const takesValue = (operator) => !NULL_OPERATORS.has(operator)
const takesList = (operator) => LIST_OPERATORS.has(operator)

// The dimensionality decides which visualizations exist, so the current pick
// has to follow it rather than survive it.
watch(
  () => form.dimension,
  (dimension) => {
    form.viz = defaultVisualization(dimension)
    if (dimension === '1d') form.groupBy = ''
    formError.value = ''
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
    form.filters.splice(0)
    formError.value = ''
  }
)

watch(
  () => [form.joinEnabled, form.joinCollection],
  () => {
    const stale = (path) => path.startsWith(`${JOIN_ALIAS}.`)
    if (stale(form.metricField)) form.metricField = ''
    if (stale(form.groupBy)) form.groupBy = ''
    for (const filter of form.filters) {
      if (stale(filter.field)) filter.field = ''
    }
    if (!form.joinEnabled) {
      form.joinCollection = ''
      form.joinLocalField = ''
      form.joinForeignField = '_id'
    }
    formError.value = ''
  }
)

function addFilter() {
  if (!canAddFilter.value) return
  form.filters.push({ field: '', operator: '$eq', value: '' })
  formError.value = ''
}

function removeFilter(index) {
  form.filters.splice(index, 1)
  formError.value = ''
}

/**
 * Filter values are typed as text but reach MongoDB as what they look like —
 * `year` is stored as a number and `semester` as a string, and a quoted "2425"
 * would simply match nothing.
 */
function coerceValue(text) {
  const trimmed = String(text ?? '').trim()
  if (trimmed === '') return null
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  const asNumber = Number(trimmed)
  return Number.isNaN(asNumber) ? trimmed : asNumber
}

const coerceList = (text) =>
  String(text ?? '')
    .split(',')
    .map((part) => coerceValue(part))
    .filter((value) => value !== null)

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

  for (const [index, filter] of form.filters.entries()) {
    const position = `Filter ${index + 1}`
    if (!filter.field) return `${position} needs a field.`
    if (!takesValue(filter.operator)) continue
    if (takesList(filter.operator)) {
      if (!coerceList(filter.value).length) {
        return `${position} needs at least one value, separated by commas.`
      }
    } else if (String(filter.value ?? '').trim() === '') {
      return `${position} needs a value.`
    }
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
    filters: form.filters.map((filter) => {
      const condition = { field: filter.field, operator: filter.operator }
      if (!takesValue(filter.operator)) return condition
      condition.value = takesList(filter.operator)
        ? coerceList(filter.value)
        : coerceValue(filter.value)
      return condition
    }),
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

  emit('submit', { name: form.name.trim(), spec: buildSpec(), viz: form.viz })
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
              placeholder="Fellows this semester"
              :disabled="busy"
            />
            <p class="hint">Optional. The API names the point after the query when left blank.</p>
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

            <p v-if="!form.filters.length" class="hint no-filters">
              No filters — the measure covers every record in the source.
            </p>

            <div v-for="(filter, index) in form.filters" :key="index" class="filter">
              <div class="field">
                <label :for="fieldId(`filter-field-${index}`)">Field</label>
                <select
                  :id="fieldId(`filter-field-${index}`)"
                  v-model="filter.field"
                  :disabled="busy"
                >
                  <option value="" disabled>Select one</option>
                  <option v-for="f in fieldOptions" :key="f.value" :value="f.value">
                    {{ f.label }}
                  </option>
                </select>
              </div>

              <div class="field">
                <label :for="fieldId(`filter-op-${index}`)">Condition</label>
                <select :id="fieldId(`filter-op-${index}`)" v-model="filter.operator" :disabled="busy">
                  <option v-for="o in OPERATORS" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
              </div>

              <div v-if="takesValue(filter.operator)" class="field">
                <label :for="fieldId(`filter-value-${index}`)">Value</label>
                <input
                  :id="fieldId(`filter-value-${index}`)"
                  v-model="filter.value"
                  type="text"
                  :placeholder="takesList(filter.operator) ? 'E&R, OPS' : '2425'"
                  :disabled="busy"
                />
              </div>
              <p v-else class="field no-value hint">Takes no value.</p>

              <button
                type="button"
                class="remove-filter"
                :aria-label="`Remove filter ${index + 1}`"
                :disabled="busy"
                @click="removeFilter(index)"
              >
                <span class="material-symbols-outlined">close</span>
              </button>
            </div>

            <button
              type="button"
              class="btn btn-quiet add-filter"
              :disabled="busy || !canAddFilter"
              @click="addFilter"
            >
              <span class="material-symbols-outlined">add</span>
              Add filter
            </button>
            <p v-if="!canAddFilter" class="hint">
              {{ MAX_FILTERS }} filters is the most one query takes.
            </p>
          </fieldset>

          <!-- How it is drawn -->
          <div class="field">
            <label :for="fieldId('viz')">Show as</label>
            <select :id="fieldId('viz')" v-model="form.viz" :disabled="busy">
              <option v-for="v in vizOptions" :key="v.value" :value="v.value">
                {{ v.label }} — {{ v.note }}
              </option>
            </select>
            <p class="hint">Changeable on the board once the point is there.</p>
          </div>

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

/* A filter row: field, condition, value, then the control that drops it. */
.filter {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 0.6rem;
  align-items: end;
  padding-bottom: 0.85rem;
  border-bottom: 1px dashed var(--rule);
}

.filter:last-of-type {
  border-bottom: 0;
  padding-bottom: 0;
}

.no-value {
  margin: 0 0 0.55rem;
}

.no-filters {
  margin: 0;
}

.remove-filter {
  background: none;
  border: 1px solid transparent;
  border-radius: 2px;
  color: var(--slate);
  cursor: pointer;
  display: flex;
  align-items: center;
  padding: 0.45rem 0.3rem;
  transition: background 0.12s, color 0.12s;
}

.remove-filter:hover:not(:disabled) {
  background: var(--canvas);
  color: var(--maroon);
}

.remove-filter:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.remove-filter .material-symbols-outlined {
  font-size: 1.1rem;
}

.add-filter {
  align-self: flex-start;
  padding: 0.4rem 0.75rem;
  font-size: 0.85rem;
}

.add-filter .material-symbols-outlined {
  font-size: 1.05rem;
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

@media (max-width: 560px) {
  .filter {
    grid-template-columns: minmax(0, 1fr) auto;
  }
}
</style>
