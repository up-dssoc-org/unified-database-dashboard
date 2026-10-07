<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { api, latestSemester } from '../api/client'
import { useAuthStore } from '../stores/auth'
import BarChart from '../components/charts/BarChart.vue'
import DonutChart from '../components/charts/DonutChart.vue'
import GroupedBarChart from '../components/charts/GroupedBarChart.vue'

const FALLBACK_YEAR = 2425

const auth = useAuthStore();

const entries = ref([]) // [{ year, semester }] from /meta/semesters
const year = ref(null) // 2526
const semester = ref('') // '' = whole academic year, otherwise 'A' | 'B'
const analytics = ref(null)
const loading = ref(true)
const error = ref('')

const canRead = computed(() => auth.can('read:all', 'read:reaff'))

const years = computed(() => [...new Set(entries.value.map((e) => e.year))].sort((a, b) => b - a))

// Only the semesters the API actually holds records for, for the chosen year.
const semesterOptions = computed(() => {
  const found = entries.value
    .filter((e) => e.year === year.value)
    .map((e) => e.semester)
    .sort()
  return found.length ? found : ['A', 'B']
})

onMounted(async () => {
  try {
    const meta = await api.semesters()
    entries.value = meta.data
    const latest = latestSemester(meta.data)
    year.value = latest ? latest.year : FALLBACK_YEAR
  } catch {
    // The semester list is a convenience; the latest known year is the fallback.
    year.value = FALLBACK_YEAR
  }
})

// Reset the semester when it does not exist in the newly picked year; that
// assignment fires the watcher below, so either branch loads exactly once.
watch(year, () => {
  if (semester.value && !semesterOptions.value.includes(semester.value)) semester.value = ''
  else load()
})
watch(semester, load)

const selectionLabel = computed(() => `${year.value ?? ''}${semester.value}`)

async function load() {
  if (!year.value) return
  if (!canRead.value) {
    loading.value = false
    error.value = 'Your account needs read:reaff or read:all to see these numbers.'
    return
  }
  loading.value = true
  error.value = ''
  try {
    // start_semester / end_semester are not implemented server-side yet.
    analytics.value = await api.getReaffiliationsSummary({
      year: year.value,
      semester: semester.value || null
    })
  } catch (e) {
    analytics.value = null
    error.value = e.detail
  } finally {
    loading.value = false
  }
}

// Every breakdown row is keyed by `_id` — the full semester code, e.g. "2526A".
const semLetter = (row) => String(row._id ?? '').slice(4)
const semLabel = (letter) =>
  letter === 'A' ? 'First semester' : letter === 'B' ? 'Second semester' : letter || 'Unknown'

// A whole-year query returns rows for both semesters in every breakdown, so
// anything not already split by semester has to be rolled up across them.
function rollup(rows, labelOf) {
  const sums = new Map()
  for (const row of rows ?? []) {
    const label = labelOf(row)
    sums.set(label, (sums.get(label) ?? 0) + row.count)
  }
  return [...sums].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
}

const sumWhere = (rows, predicate) =>
  (rows ?? []).reduce((sum, d) => (predicate(d) ? sum + d.count : sum), 0)

const wholeYear = computed(() => !analytics.value?.queried_semester)

const totals = computed(() =>
  [...(analytics.value?.total_by_semester ?? [])]
    .map((d) => ({ code: d._id, letter: semLetter(d), count: d.count }))
    .sort((a, b) => String(a.code).localeCompare(String(b.code)))
)

const grandTotal = computed(() => totals.value.reduce((sum, d) => sum + d.count, 0))

// Second semester against the first; null when the year only has one on record.
const change = computed(() =>
  totals.value.length < 2 ? null : totals.value.at(-1).count - totals.value[0].count
)

const fellows = computed(() =>
  sumWhere(analytics.value?.designation_by_semester, (d) => d.designation === 'Fellow')
)
const associates = computed(() =>
  sumWhere(analytics.value?.designation_by_semester, (d) => d.designation === 'Associate')
)

const designationRows = computed(() =>
  (analytics.value?.designation_by_semester ?? []).map((d) => ({
    group: d.designation || 'Unlisted',
    series: semLabel(semLetter(d)),
    value: d.count
  }))
)

const classificationRows = computed(() =>
  rollup(analytics.value?.classification_by_semester, (d) => d.classification || 'Not stated')
)

const committeeRows = computed(() =>
  rollup(analytics.value?.members_by_committee, (d) => d.committee || 'Unassigned')
)

const campusRows = computed(() =>
  rollup(analytics.value?.members_by_campus, (d) => d.campus_name || d.campus || 'Unknown').slice(0, 6)
)

const yearLevelRows = computed(() =>
  rollup(analytics.value?.members_by_year_level, (d) => d.year_level || 'Not stated')
    .filter((d) => d.value > 0)
    .sort((a, b) => a.label.localeCompare(b.label))
)

const degreeRows = computed(() =>
  rollup(
    (analytics.value?.classification_by_degree_program ?? []).filter((d) => d.degree_name),
    (d) => d.degree_name
  ).slice(0, 10)
)

const academicYear = computed(() => {
  const y = String(analytics.value?.academic_year ?? year.value ?? '')
  return y.length === 4 ? `AY 20${y.slice(0, 2)}–20${y.slice(2)}` : y
})

const periodLabel = computed(() => {
  if (!analytics.value) return selectionLabel.value
  const q = analytics.value.queried_semester
  return q ? `${academicYear.value}, ${semLabel(q).toLowerCase()}` : `${academicYear.value}, full year`
})

const scopeNote = computed(() =>
  wholeYear.value ? 'Both semesters of the year combined.' : 'Recorded for this semester.'
)
</script>

<template>
  <header class="head">
    <div>
      <h1>Reaffiliation summary</h1>
      <p class="muted sub">{{ periodLabel }}</p>
    </div>
    <div class="pickers">
      <div class="picker">
        <label for="ay">Academic year</label>
        <select id="ay" v-model="year">
          <option v-for="y in years" :key="y" :value="y">
            {{ `20${String(y).slice(0, 2)}–20${String(y).slice(2)}` }}
          </option>
          <option v-if="!years.length" :value="year">{{ year }}</option>
        </select>
      </div>
      <div class="picker">
        <label for="sem">Period</label>
        <select id="sem" v-model="semester">
          <option value="">Whole year</option>
          <option v-for="s in semesterOptions" :key="s" :value="s">
            {{ `${semLabel(s)} (${year}${s})` }}
          </option>
        </select>
      </div>
    </div>
  </header>

  <p v-if="error" class="notice" role="alert">{{ error }}</p>
  <p v-else-if="loading" class="muted">Loading {{ selectionLabel }}…</p>

  <div v-else-if="analytics" class="board">
    <section class="headline panel">
      <div class="figure-block">
        <p class="big figure">{{ grandTotal }}</p>
        <p class="big-label">
          {{ wholeYear ? 'reaffiliations recorded across the year' : 'members reaffiliated this semester' }}
        </p>
      </div>
      <dl class="side">
        <template v-if="wholeYear">
          <div v-for="t in totals" :key="t.code">
            <dt>{{ semLabel(t.letter) }}</dt>
            <dd class="figure">{{ t.count }}</dd>
          </div>
          <div v-if="change !== null">
            <dt>Change across the year</dt>
            <dd class="figure" :class="change < 0 ? 'down' : 'up'">
              {{ change > 0 ? '+' : '' }}{{ change }}
            </dd>
          </div>
        </template>
        <div>
          <dt>Fellows</dt>
          <dd class="figure">{{ fellows }}</dd>
        </div>
        <div>
          <dt>Associates</dt>
          <dd class="figure">{{ associates }}</dd>
        </div>
      </dl>
    </section>

    <section class="panel wide">
      <h2>Designations</h2>
      <p class="panel-note">
        Standing held at the time of each reaffiliation.
        {{ wholeYear ? 'Compared across both semesters.' : '' }}
      </p>
      <GroupedBarChart :data="designationRows" :height="250" />
    </section>

    <section class="panel">
      <h2>Campus</h2>
      <p class="panel-note">Resolved from each member's degree program.</p>
      <DonutChart :data="campusRows" center-label="members" />
    </section>

    <section class="panel">
      <h2>Committees</h2>
      <p class="panel-note">{{ wholeYear ? 'Assignments across both semesters.' : 'Assignments recorded for this semester.' }}</p>
      <BarChart :data="committeeRows" :label-width="170" color="#0f4a34" />
    </section>

    <section class="panel">
      <h2>Year level</h2>
      <p class="panel-note">Undergraduate standing at reaffiliation.</p>
      <BarChart :data="yearLevelRows" :label-width="90" color="#3e5c76" />
    </section>

    <section class="panel">
      <h2>Classification</h2>
      <p class="panel-note">{{ scopeNote }}</p>
      <BarChart :data="classificationRows" :label-width="130" color="#7b1113" />
    </section>

    <section class="panel wide">
      <h2>Largest degree programs</h2>
      <p class="panel-note">
        Top ten. {{ scopeNote }}
      </p>
      <BarChart :data="degreeRows" :label-width="230" color="#b8842b" />
    </section>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 1rem;
  padding-bottom: 1.1rem;
  margin-bottom: 1.4rem;
  border-bottom: 1px solid var(--rule);
}

.sub {
  margin: 0.2rem 0 0;
  font-size: 0.9rem;
}

.pickers {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.picker {
  min-width: 8.5rem;
}

.board {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  align-items: start;
}

.wide {
  grid-column: 1 / -1;
}

.headline {
  grid-column: 1 / -1;
  display: flex;
  gap: 2.5rem;
  align-items: center;
  flex-wrap: wrap;
  border-left: 4px solid var(--maroon);
}

.big {
  margin: 0;
  font-size: 3.6rem;
  line-height: 1;
  font-weight: 500;
}

.big-label {
  margin: 0.3rem 0 0;
  color: var(--slate);
  font-size: 0.9rem;
  max-width: 12rem;
}

.side {
  display: flex;
  gap: 2.2rem;
  margin: 0;
  flex-wrap: wrap;
}

.side dt {
  color: var(--slate);
  font-size: 0.82rem;
}

.side dd {
  margin: 0.15rem 0 0;
  font-size: 1.5rem;
}

.down {
  color: var(--maroon);
}

.up {
  color: var(--forest);
}

@media (max-width: 900px) {
  .board {
    grid-template-columns: 1fr;
  }
}
</style>
