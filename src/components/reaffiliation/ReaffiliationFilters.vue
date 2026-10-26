<script setup>
/**
 * The filter bar over a reaffiliation list.
 *
 * Reaffiliations are searched by field rather than by free text, so each
 * filter is a dropdown of the values the field can hold. Committee, year
 * level, designation and classification take any number of values (matched as
 * "any of"); degree program takes one, or none for every degree, so a query
 * never has to combine programs.
 *
 * `v-model` is the object from `emptyReaffFilters()`. Each change emits a new
 * object, so the caller can debounce it and watch it by identity. The degree
 * and committee options are fetched here on mount; a list that fails to load
 * leaves its dropdown disabled and says why, and the other filters still work.
 */
import { computed, onMounted, ref, useId } from 'vue'
import { api } from '@/api/client'
import MultiSelect from '@/components/generic/MultiSelect.vue'
import {
  CLASSIFICATIONS,
  DESIGNATIONS,
  YEAR_LEVELS,
  emptyReaffFilters,
  hasReaffFilters,
  loadAllDegrees,
} from './reaffFilters'

const props = defineProps({
  modelValue: { type: Object, required: true },
})

const emit = defineEmits(['update:modelValue'])

const uid = useId()

function update(key, value) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

function clearAll() {
  emit('update:modelValue', emptyReaffFilters())
}

const active = computed(() => hasReaffFilters(props.modelValue))

const asOptions = (values) => values.map((v) => ({ value: v, label: v }))
const yearLevelOptions = asOptions(YEAR_LEVELS)
const designationOptions = asOptions(DESIGNATIONS)
const classificationOptions = asOptions(CLASSIFICATIONS)

// ── Degree programs ──

const degrees = ref([])
const degreesLoading = ref(true)
const degreesError = ref('')

// Grouped under their campus, in campus then course order, so a long list
// still scans.
const degreeGroups = computed(() => {
  const byCampus = new Map()
  const sorted = [...degrees.value].sort(
    (a, b) =>
      String(a.campus_id).localeCompare(String(b.campus_id)) ||
      String(a.course_name).localeCompare(String(b.course_name))
  )
  for (const degree of sorted) {
    const campus = degree.campus_id || 'No campus'
    if (!byCampus.has(campus)) byCampus.set(campus, [])
    byCampus.get(campus).push(degree)
  }
  return [...byCampus].map(([campus, list]) => ({ campus, degrees: list }))
})

async function fetchDegrees() {
  try {
    degrees.value = await loadAllDegrees()
  } catch (e) {
    degreesError.value = e?.detail || 'Could not load degree programs.'
  } finally {
    degreesLoading.value = false
  }
}

// ── Committees ──

const subcommittees = ref([])
const subcommitteesLoading = ref(true)
const subcommitteesError = ref('')

// The filter matches on the subcommittee's own ID (`E&R-02010`), which the
// list returns as `_id`; `comm_id` there is the parent committee, used as the
// group. A record without an `_id` cannot be filtered on, so it is left out.
const committeeOptions = computed(() =>
  subcommittees.value
    .filter((s) => s._id)
    .sort(
      (a, b) =>
        String(a.comm_id).localeCompare(String(b.comm_id)) ||
        String(a.subcategory_num).localeCompare(String(b.subcategory_num))
    )
    .map((s) => ({ value: s._id, label: s.subcomm_name || s._id, group: s.comm_id }))
)

const committeeUnavailable = computed(
  () => !subcommitteesLoading.value && !subcommitteesError.value &&
    subcommittees.value.length > 0 && committeeOptions.value.length === 0
)

async function fetchSubcommittees() {
  try {
    const res = await api.getSubcommittees()
    subcommittees.value = res?.data ?? []
  } catch (e) {
    subcommitteesError.value = e?.detail || 'Could not load committees.'
  } finally {
    subcommitteesLoading.value = false
  }
}

onMounted(() => {
  fetchDegrees()
  fetchSubcommittees()
})
</script>

<template>
  <div class="filters">
    <div class="filter degree">
      <label :for="`${uid}-degree`">Degree program</label>
      <select
        :id="`${uid}-degree`"
        :value="modelValue.degree_id"
        :disabled="degreesLoading || Boolean(degreesError)"
        @change="update('degree_id', $event.target.value === '' ? '' : Number($event.target.value))"
      >
        <option value="">{{ degreesLoading ? 'Loading…' : 'Any degree' }}</option>
        <optgroup v-for="group in degreeGroups" :key="group.campus" :label="group.campus">
          <option v-for="d in group.degrees" :key="d._id" :value="d._id">
            {{ d.course_name }}
          </option>
        </optgroup>
      </select>
      <p v-if="degreesError" class="hint">{{ degreesError }}</p>
    </div>

    <div class="filter">
      <label :for="`${uid}-committee`">Committee</label>
      <MultiSelect
        :id="`${uid}-committee`"
        :model-value="modelValue.comm_id"
        :options="committeeOptions"
        placeholder="Any committee"
        :loading="subcommitteesLoading"
        :disabled="subcommitteesLoading || Boolean(subcommitteesError) || committeeUnavailable"
        @update:model-value="update('comm_id', $event)"
      />
      <p v-if="subcommitteesError" class="hint">{{ subcommitteesError }}</p>
      <p v-else-if="committeeUnavailable" class="hint">Committee filtering is unavailable right now.</p>
    </div>

    <div class="filter">
      <label :for="`${uid}-year-level`">Year level</label>
      <MultiSelect
        :id="`${uid}-year-level`"
        :model-value="modelValue.year_level"
        :options="yearLevelOptions"
        placeholder="Any year level"
        @update:model-value="update('year_level', $event)"
      />
    </div>

    <div class="filter">
      <label :for="`${uid}-designation`">Designation</label>
      <MultiSelect
        :id="`${uid}-designation`"
        :model-value="modelValue.designation"
        :options="designationOptions"
        placeholder="Any designation"
        @update:model-value="update('designation', $event)"
      />
    </div>

    <div class="filter">
      <label :for="`${uid}-classification`">Classification</label>
      <MultiSelect
        :id="`${uid}-classification`"
        :model-value="modelValue.classification"
        :options="classificationOptions"
        placeholder="Any classification"
        @update:model-value="update('classification', $event)"
      />
    </div>

    <button type="button" class="btn btn-quiet clear" :disabled="!active" @click="clearAll">
      Clear filters
    </button>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.9rem;
  align-items: flex-start;
  margin-bottom: 1.2rem;
}

.filter {
  flex: 1 1 10rem;
  min-width: 10rem;
  max-width: 15rem;
}

.filter.degree {
  flex-basis: 16rem;
  max-width: 20rem;
}

/* Sits on the dropdowns' baseline: the label above them is the offset. */
.clear {
  align-self: flex-start;
  margin-top: calc(0.85rem * 1.5 + 0.35rem);
  padding-block: 0.55rem;
  white-space: nowrap;
}

.hint {
  margin: 0.3rem 0 0;
  font-size: 0.8rem;
  color: #c0392b;
}
</style>
