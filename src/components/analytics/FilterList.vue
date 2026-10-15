<script setup>
/**
 * An editable list of filter rows, each after the first joined to the row
 * before it by AND or OR (AND unless changed).
 *
 * AND binds tighter than OR, so the ORs split the list into groups and a record
 * is kept when it matches every filter of at least one group — see `filters.js`
 * for how that becomes `filters` / `any_of`. OR connectors are drawn as a full
 * divider so those groups can be seen at a glance.
 *
 * The list is edited in place: `filters` is the caller's reactive array of
 * `{ join, field, operator, value }` rows. `change` fires on every structural
 * edit, so the caller can clear a stale validation message.
 */
import { computed, useId } from 'vue'
import { MAX_FILTERS, OPERATORS } from '@/api/analyticsSchema'
import { CONNECTORS, blankFilter, takesList, takesValue } from './filters'

const props = defineProps({
  filters: { type: Array, required: true },
  /** Field options, as `addressableFields` returns them. */
  fields: { type: Array, required: true },
  busy: { type: Boolean, default: false },
  /** What one row is called in labels: "Filter 2", "AY2425A filter 2". */
  subject: { type: String, default: 'Filter' },
  /** Shown when the list is empty. */
  emptyText: { type: String, default: '' },
})

const emit = defineEmits(['change'])

const uid = useId()
const fieldId = (key) => `${uid}-${key}`

const canAdd = computed(() => props.filters.length < MAX_FILTERS)
const hasOr = computed(() => props.filters.some((f, i) => i > 0 && f.join === 'or'))

function add() {
  if (!canAdd.value) return
  props.filters.push(blankFilter())
  emit('change')
}

function remove(index) {
  props.filters.splice(index, 1)
  emit('change')
}

function setJoin(filter, join) {
  filter.join = join
  emit('change')
}
</script>

<template>
  <div class="filter-list">
    <p v-if="!filters.length && emptyText" class="hint flush">{{ emptyText }}</p>

    <template v-for="(filter, index) in filters" :key="index">
      <div
        v-if="index > 0"
        class="connector"
        :class="filter.join"
        role="radiogroup"
        :aria-label="`How ${subject} ${index + 1} joins ${subject} ${index}`"
      >
        <span class="seg">
          <button
            v-for="c in CONNECTORS"
            :key="c.value"
            type="button"
            role="radio"
            :aria-checked="filter.join === c.value"
            :class="{ on: filter.join === c.value }"
            :disabled="busy"
            @click="setJoin(filter, c.value)"
          >
            {{ c.label }}
          </button>
        </span>
      </div>

      <div class="filter">
        <div class="field">
          <label :for="fieldId(`field-${index}`)">Field</label>
          <select :id="fieldId(`field-${index}`)" v-model="filter.field" :disabled="busy">
            <option value="" disabled>Select one</option>
            <option v-for="f in fields" :key="f.value" :value="f.value">{{ f.label }}</option>
          </select>
        </div>

        <div class="field">
          <label :for="fieldId(`op-${index}`)">Condition</label>
          <select :id="fieldId(`op-${index}`)" v-model="filter.operator" :disabled="busy">
            <option v-for="o in OPERATORS" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>

        <div v-if="takesValue(filter.operator)" class="field">
          <label :for="fieldId(`value-${index}`)">Value</label>
          <input
            :id="fieldId(`value-${index}`)"
            v-model="filter.value"
            type="text"
            :placeholder="takesList(filter.operator) ? 'E&R, OPS' : '2425'"
            :disabled="busy"
          />
        </div>
        <p v-else class="field no-value hint">Takes no value.</p>

        <button
          type="button"
          class="remove"
          :aria-label="`Remove ${subject} ${index + 1}`"
          :disabled="busy"
          @click="remove(index)"
        >
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    </template>

    <button type="button" class="btn btn-quiet add" :disabled="busy || !canAdd" @click="add">
      <span class="material-symbols-outlined">add</span>
      Add filter
    </button>

    <p v-if="hasOr" class="hint flush">
      AND is applied before OR: a record is kept when it matches every filter in at least one of
      the groups the ORs divide.
    </p>
    <p v-if="!canAdd" class="hint flush">{{ MAX_FILTERS }} filters is the most one list takes.</p>
  </div>
</template>

<style scoped>
.filter-list {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

/* A filter row: field, condition, value, then the control that drops it. */
.filter {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 0.6rem;
  align-items: end;
}

.field label {
  margin-bottom: 0.35rem;
}

/* AND sits quietly between rows; OR is a full divider, since it starts a new group. */
.connector {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.connector.or::before,
.connector.or::after {
  content: '';
  flex: 1;
  border-top: 1px solid var(--maroon);
  opacity: 0.45;
}

.seg {
  display: inline-flex;
  border: 1px solid var(--rule);
  border-radius: 2px;
  overflow: hidden;
}

.seg button {
  background: none;
  border: 0;
  padding: 0.12rem 0.55rem;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--slate);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.seg button + button {
  border-left: 1px solid var(--rule);
}

.seg button.on {
  background: var(--maroon);
  color: #fff;
}

.seg button:hover:not(:disabled):not(.on) {
  background: var(--canvas);
  color: var(--ink);
}

.seg button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.no-value {
  margin: 0 0 0.55rem;
}

.remove {
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

.remove:hover:not(:disabled) {
  background: var(--canvas);
  color: var(--maroon);
}

.remove:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.remove .material-symbols-outlined {
  font-size: 1.1rem;
}

.add {
  align-self: flex-start;
  padding: 0.4rem 0.75rem;
  font-size: 0.85rem;
}

.add .material-symbols-outlined {
  font-size: 1.05rem;
}

.hint {
  margin: 0.3rem 0 0;
  font-size: 0.8rem;
  color: var(--slate);
}

.hint.flush {
  margin: 0;
}

@media (max-width: 560px) {
  .filter {
    grid-template-columns: minmax(0, 1fr) auto;
  }
}
</style>
