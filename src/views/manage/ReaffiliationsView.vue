<script setup>
import { computed, inject, onMounted, ref, watch } from 'vue'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { toast } from '@/components/generic/useToast'
import DataTable from '@/components/table/DataTable.vue'
import RowActionMenu from '@/components/table/RowActionMenu.vue'
import TablePager from '@/components/table/TablePager.vue'
import AddEditModal from '@/components/generic/AddEditModal.vue'
import DeleteModal from '@/components/generic/DeleteModal.vue'
import OptionPickerModal from '@/components/generic/OptionPickerModal.vue'
import SingleReaffiliationHistory from '@/components/reaffiliation/SingleReaffiliationHistory.vue'
import posthog from 'posthog-js'

const isPostHogConfigured = inject('isPostHogConfigured', false)
const auth = useAuthStore()

const page = ref(1)
const result = ref(null)
const loading = ref(true)
const error = ref('')
const search = ref('')
// The admin list is the only one that returns soft-deleted records, so the
// page can be narrowed to just the active or just the deleted ones.
const status = ref('all')

// The reaffiliation open in the edit modal, plus the state AddEditModal
// renders while the save runs.
const editTarget = ref(null)
const saving = ref(false)
const editError = ref('')

// The degree picker stacked over the edit modal. `pickedDegree` is the row
// chosen in it, kept so the field can name the degree rather than its ID.
const pickingDegree = ref(false)
const pickedDegree = ref(null)
const degreePage = ref(1)
const degreeResult = ref(null)
const degreesLoading = ref(false)
const degreesError = ref('')
// '' lists every campus's degrees; a campus ID narrows to that campus.
const degreeCampus = ref('')

// Campuses back the picker's campus filter. Loaded on first open and kept
// after, so reopening the picker does not refetch.
const campuses = ref([])
const campusesLoading = ref(false)
const campusesError = ref('')

// The reaffiliation awaiting delete confirmation, plus the state DeleteModal
// renders while the request is in flight.
const deleteTarget = ref(null)
const deleting = ref(false)
const deleteError = ref('')

// Restore has no confirmation step, so the row's own button carries the busy
// state — holds the `_id` of the record currently being restored.
const restoringId = ref(null)

// The reaffiliation whose status history is open. The modal does its own
// loading and writes, so nothing else is tracked here.
const historyTarget = ref(null)

const canRead = computed(() => auth.can('read:all'))
const canEdit = computed(() => auth.can('update:all', 'update:reaff'))
const canDelete = computed(() => auth.can('delete:all', 'delete:reaff'))
// The restore endpoint requires all three permissions, not any one of them.
const canRestore = computed(
  () => auth.can('read:all') && auth.can('update:all') && auth.can('delete:all')
)
// Every reader of this page can open the history; writing to it is gated
// inside the modal.
const canViewHistory = canRead
const hasAnyAction = computed(
  () => canEdit.value || canViewHistory.value || canDelete.value || canRestore.value
)

onMounted(load)
watch(page, load)

// TODO: implement delete committee endpoint

async function load() {
  if (!canRead.value) {
    loading.value = false
    error.value = 'Your account needs read:all to see reaffiliations.'
    return
  }
  loading.value = true
  error.value = ''
  try {
    // The linked data carries `degree_data`, which the table and the edit
    // modal use to name the degree instead of showing its ID.
    result.value = await api.getAllReaffiliations({
      page: page.value,
      include_member_data: true,
    })
  } catch (e) {
    result.value = null
    error.value = e.detail
  } finally {
    loading.value = false
  }
}

function editReaff(reaff) {
  editError.value = ''
  pickedDegree.value = null
  editTarget.value = reaff
}

function cancelEdit() {
  editTarget.value = null
  editError.value = ''
  pickingDegree.value = false
}

async function saveReaff(values) {
  const reaff = editTarget.value
  if (!reaff) return
  saving.value = true
  editError.value = ''
  try {
    // Blank fields arrive as null and the client drops them, so an untouched
    // field is left as it is rather than cleared.
    await api.updateReaffiliation(reaff._id, values)
    if (isPostHogConfigured) posthog.capture('reaffiliation_updated')
    editTarget.value = null
    toast.success('Reaffiliation updated!')
    await load()
  } catch (e) {
    // Kept in the modal so the edits survive and can be retried.
    editError.value = e?.detail || 'Failed to save reaffiliation.'
    toast.error('Failed to update reaffiliation')
  } finally {
    saving.value = false
  }
}

async function loadCampuses() {
  if (campuses.value.length || campusesLoading.value) return
  campusesLoading.value = true
  campusesError.value = ''
  try {
    const res = await api.getCampuses()
    campuses.value = res?.data ?? []
  } catch (e) {
    campusesError.value = e?.detail || 'Could not load campuses.'
  } finally {
    campusesLoading.value = false
  }
}

// Switching campus or page quickly can leave an older request still in
// flight; only the latest one is allowed to land.
let degreesRequest = 0

async function loadDegrees() {
  const ticket = ++degreesRequest
  degreesLoading.value = true
  degreesError.value = ''
  try {
    const res = degreeCampus.value
      ? await api.getCampusDegreePrograms(degreeCampus.value, degreePage.value)
      : await api.getDegrees({ page: degreePage.value })
    if (ticket === degreesRequest) degreeResult.value = res
  } catch (e) {
    if (ticket !== degreesRequest) return
    degreeResult.value = null
    degreesError.value = e?.detail || 'Could not load degree programs.'
  } finally {
    if (ticket === degreesRequest) degreesLoading.value = false
  }
}

function openDegreePicker() {
  degreeCampus.value = ''
  degreePage.value = 1
  pickingDegree.value = true
  loadCampuses()
  loadDegrees()
}

function changeDegreeCampus() {
  degreePage.value = 1
  loadDegrees()
}

function changeDegreePage(next) {
  degreePage.value = next
  loadDegrees()
}

function pickDegree(degree, set) {
  pickedDegree.value = degree
  set(degree._id)
  pickingDegree.value = false
}

function askDeleteReaff(reaff) {
  deleteError.value = ''
  deleteTarget.value = reaff
}

function cancelDelete() {
  deleteTarget.value = null
  deleteError.value = ''
}

async function confirmDelete() {
  const reaff = deleteTarget.value
  if (!reaff) return
  deleting.value = true
  deleteError.value = ''
  try {
    await api.deleteReaffiliation(reaff._id)
    if (isPostHogConfigured) posthog.capture('reaffiliation_deleted')
    deleteTarget.value = null
    toast.warning('Reaffiliation deleted!')
    // The delete is a soft one: the record stays on the page flagged as
    // deleted, with Restore offered in place of Edit and Delete.
    await load()
  } catch (e) {
    // Kept in the modal so the record stays on screen and can be retried.
    deleteError.value = e?.detail || 'Failed to delete reaffiliation.'
    toast.error('Failed to delete reaffiliation')
  } finally {
    deleting.value = false
  }
}

async function restoreReaff(reaff) {
  if (!reaff || restoringId.value !== null) return
  restoringId.value = reaff._id
  try {
    await api.restoreReaffiliation(reaff._id)
    if (isPostHogConfigured) posthog.capture('reaffiliation_restored')
    toast.success('Reaffiliation restored!')
    await load()
  } catch (e) {
    toast.error(e?.detail || 'Failed to restore reaffiliation')
  } finally {
    restoringId.value = null
  }
}

const semesterOf = (r) => (r?.year ? `${r.year}${r.semester ?? ''}` : '')

// "Computer Science (UPD)" — the program, then the campus it belongs to.
function degreeLabel(degree) {
  if (!degree?.course_name) return ''
  return degree.campus_id ? `${degree.course_name} (${degree.campus_id})` : degree.course_name
}

// Names the reaffiliation in labels now that its own ID is not on screen.
const reaffName = (r) => `${r.dssoc_id} · ${semesterOf(r)}`

// API timestamps are ISO date-times; show them in the viewer's locale.
function formatDateTime(value) {
  if (!value) return value
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// What the degree field shows: the program just picked, else the one the
// record already links to. A record whose degree did not come back linked
// falls back to its ID so the field never reads as empty when it is not.
function degreeFieldText(value) {
  const label = degreeLabel(pickedDegree.value ?? editTarget.value?.degree)
  if (label) return label
  return value === '' || value === null ? '' : `Degree #${value}`
}

// The four fields PATCH /reaffiliations/reaff/{id} accepts. Everything else on
// the record — the member, the semester — identifies it and is fixed.
const reaffFields = [
  {
    // Rendered through the `field:degree_id` slot as a picker; the type still
    // makes the payload a number.
    key: 'degree_id',
    label: 'Degree program',
    type: 'number',
    hint: 'Opens the full list of degree programs, which can be narrowed to one campus.',
  },
  {
    key: 'year_level',
    label: 'Year level',
    type: 'select',
    placeholder: 'Leave unchanged',
    options: ['I', 'II', 'III', 'IV', 'V'],
  },
  {
    key: 'designation',
    label: 'Designation',
    type: 'select',
    placeholder: 'Leave unchanged',
    options: ['Associate', 'Fellow'],
  },
  {
    key: 'classification',
    label: 'Classification',
    type: 'select',
    placeholder: 'Leave unchanged',
    options: ['Undergraduate', 'Graduate', 'Alumni', 'Researcher', 'Staff'],
  },
]

const columns = [
  { key: 'dssoc_id', label: 'DSSOC ID', cellClass: 'figure' },
  { key: 'year', label: 'Semester', cellClass: 'figure', format: (_v, row) => semesterOf(row) },
  {
    key: 'degree',
    label: 'Degree Program',
    format: (degree, row) =>
      degreeLabel(degree) || (row.degree_id != null ? `Degree #${row.degree_id}` : ''),
  },
  { key: 'year_level', label: 'Year Level' },
  { key: 'designation', label: 'Designation' },
  { key: 'classification', label: 'Classification' },
  { key: 'remarks', label: 'Remarks' },
  {
    key: 'metadata.updated_at',
    label: 'Updated',
    cellClass: 'figure',
    format: formatDateTime,
    empty: 'Never',
  },
]

const degreeColumns = [
  { key: 'course_name', label: 'Course' },
  { key: 'campus_id', label: 'Campus', cellClass: 'figure' },
  { key: 'college', label: 'College', cellClass: 'figure' },
]

// The items of each row's overflow menu. Edit, Edit History and Delete apply
// to an active record; a deleted one can only be restored.
const menuItems = computed(() => [
  {
    key: 'edit',
    label: 'Edit',
    icon: 'edit',
    show: (r) => canEdit.value && !r.is_deleted,
    onClick: editReaff,
  },
  {
    key: 'history',
    label: 'Edit History',
    icon: 'history',
    show: (r) => canViewHistory.value && !r.is_deleted,
    onClick: (r) => (historyTarget.value = r),
  },
  {
    key: 'delete',
    label: 'Delete',
    icon: 'delete',
    danger: true,
    show: (r) => canDelete.value && !r.is_deleted,
    onClick: askDeleteReaff,
  },
  {
    key: 'restore',
    label: (r) => (restoringId.value === r._id ? 'Restoring…' : 'Restore'),
    icon: 'restore_from_trash',
    // Any restore in flight blocks the others, matching restoreReaff's guard.
    disabled: () => restoringId.value !== null,
    show: (r) => canRestore.value && r.is_deleted,
    onClick: restoreReaff,
  },
])

// A row with nothing to offer gets no menu, rather than a button that opens
// onto an empty list.
const hasMenuItems = (row) => menuItems.value.some((item) => item.show(row))

// Filters the loaded page. Server-side search is not exposed yet.
const rows = computed(() => {
  const list = result.value?.data ?? []
  const q = search.value.trim().toLowerCase()
  return list.filter((r) => {
    if (status.value === 'active' && r.is_deleted) return false
    if (status.value === 'deleted' && !r.is_deleted) return false
    if (!q) return true
    return [
      r.dssoc_id,
      semesterOf(r),
      degreeLabel(r.degree),
      r.year_level,
      r.designation,
      r.classification,
      r.remarks,
    ].some((v) => String(v ?? '').toLowerCase().includes(q))
  })
})

const firstOnPage = computed(() =>
  result.value?.total ? (result.value.page - 1) * result.value.page_size + 1 : 0
)
const lastOnPage = computed(() =>
  Math.min(result.value?.page * result.value?.page_size, result.value?.total ?? 0)
)
</script>

<template>
  <header class="head">
    <div>
      <h1>Reaffiliations</h1>
      <p class="muted sub">
        Every reaffiliation record, including the ones that have been deleted.
      </p>
    </div>
    <div class="controls">
      <div>
        <label for="status">Status</label>
        <select id="status" v-model="status">
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="deleted">Deleted</option>
        </select>
      </div>
      <div class="search">
        <label for="q">Find on this page</label>
        <input
          id="q"
          v-model="search"
          type="search"
          placeholder="DSSOC ID, semester, degree, designation"
        />
      </div>
    </div>
  </header>

  <p v-if="error" class="notice" role="alert">{{ error }}</p>
  <p v-else-if="loading" class="muted">Loading reaffiliations…</p>

  <template v-else-if="result">
    <p class="count">
      <span class="figure">{{ result.total }}</span> reaffiliations<span v-if="result.total">
        · showing {{ firstOnPage }}–{{ lastOnPage }}</span
      >
    </p>

    <DataTable
      :columns="columns"
      :rows="rows"
      row-key="_id"
      :show-actions="hasAnyAction"
      compact-actions
      :empty-text="
        search || status !== 'all'
          ? 'No reaffiliation on this page matches those filters. Try another page or clear them.'
          : 'No reaffiliations recorded yet.'
      "
    >
      <!-- The admin endpoint also returns deleted records; flag them so they
           are not mistaken for active ones. -->
      <template #cell:dssoc_id="{ row, value }">
        {{ value }}
        <span v-if="row.is_deleted" class="tag figure">Deleted</span>
      </template>

      <template #actions="{ row }">
        <RowActionMenu
          v-if="hasMenuItems(row)"
          :items="menuItems"
          :row="row"
          :aria-label="`Actions for reaffiliation ${reaffName(row)}`"
        />
      </template>
    </DataTable>

    <TablePager v-model:page="page" :total-pages="result.total_pages" />
  </template>

  <AddEditModal
    v-if="editTarget"
    title="Edit reaffiliation"
    :description="`Updating ${editTarget.dssoc_id} · ${semesterOf(editTarget)}. A field left blank keeps its current value.`"
    submit-label="Save reaffiliation"
    :fields="reaffFields"
    :values="editTarget"
    :busy="saving"
    :error="editError"
    @close="cancelEdit"
    @submit="saveReaff"
  >
    <template #field:degree_id="{ id, value, set, disabled, invalid, describedby }">
      <button
        :id="id"
        type="button"
        class="picker-trigger"
        :class="{ empty: !degreeFieldText(value) }"
        :disabled="disabled"
        aria-haspopup="dialog"
        :aria-invalid="invalid ? 'true' : undefined"
        :aria-describedby="describedby"
        @click="openDegreePicker"
      >
        <span class="picker-text">{{ degreeFieldText(value) || 'Choose a degree program' }}</span>
        <span class="material-symbols-outlined" aria-hidden="true">expand_more</span>
      </button>

      <OptionPickerModal
        v-if="pickingDegree"
        title="Choose a degree program"
        description="Pick the program this reaffiliation is enrolled under."
        :columns="degreeColumns"
        :rows="degreeResult?.data ?? []"
        :selected-key="value === '' || value === null ? null : Number(value)"
        :page="degreePage"
        :total-pages="degreeResult?.total_pages ?? 1"
        :total="degreeResult?.total ?? null"
        :loading="degreesLoading"
        :error="degreesError"
        :option-label="degreeLabel"
        :empty-text="
          degreeCampus
            ? 'No degree programs recorded for this campus yet.'
            : 'No degree programs recorded yet.'
        "
        @update:page="changeDegreePage"
        @select="(degree) => pickDegree(degree, set)"
        @close="pickingDegree = false"
      >
        <template #toolbar>
          <div class="campus-filter">
            <label for="degree-campus">Campus</label>
            <select
              id="degree-campus"
              v-model="degreeCampus"
              :disabled="campusesLoading"
              @change="changeDegreeCampus"
            >
              <option value="">{{ campusesLoading ? 'Loading…' : 'All campuses' }}</option>
              <option v-for="c in campuses" :key="c._id" :value="c._id">
                {{ c.campus_name ? `${c.campus_name} (${c._id})` : c._id }}
              </option>
            </select>
            <p v-if="campusesError" class="hint">{{ campusesError }}</p>
          </div>
        </template>
      </OptionPickerModal>
    </template>
  </AddEditModal>

  <SingleReaffiliationHistory
    v-if="historyTarget"
    :reaff="historyTarget"
    @close="historyTarget = null"
  />

  <DeleteModal
    v-if="deleteTarget"
    title="Delete reaffiliation"
    confirm-label="Delete reaffiliation"
    :busy="deleting"
    :error="deleteError"
    @close="cancelDelete"
    @confirm="confirmDelete"
  >
    Delete the <strong>{{ semesterOf(deleteTarget) }}</strong> reaffiliation of
    <strong>{{ deleteTarget.dssoc_id }}</strong>? It will drop out of the
    member's history and the semester summaries. It stays listed here as
    deleted and can be restored.
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
  gap: 0.9rem;
  align-items: flex-end;
}

.search {
  min-width: 18rem;
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

.tag {
  margin-left: 0.5rem;
  font-size: 0.72rem;
  padding: 0.1rem 0.45rem;
  background: var(--canvas);
  border: 1px solid var(--rule);
  border-radius: 2px;
  color: var(--slate);
}

/* Looks like the modal's other selects, but opens the degree picker. */
.picker-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  width: 100%;
  font: inherit;
  text-align: left;
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: 2px;
  padding: 0.55rem 0.65rem;
  cursor: pointer;
}

.picker-trigger:focus {
  border-color: var(--maroon);
  outline: none;
}

.picker-trigger[aria-invalid='true'] {
  border-color: #c0392b;
}

.picker-trigger:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.picker-trigger.empty .picker-text {
  color: var(--slate);
}

.picker-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-trigger .material-symbols-outlined {
  font-size: 1.2rem;
  color: var(--slate);
}

.campus-filter {
  min-width: 16rem;
}

.campus-filter .hint {
  margin: 0.3rem 0 0;
  font-size: 0.8rem;
  color: #c0392b;
}
</style>
