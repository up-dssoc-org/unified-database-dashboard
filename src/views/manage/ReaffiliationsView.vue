<script setup>
import { computed, inject, onMounted, ref, watch } from 'vue'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { toast } from '@/components/generic/useToast'
import DataTable from '@/components/table/DataTable.vue'
import TablePager from '@/components/table/TablePager.vue'
import AddEditModal from '@/components/generic/AddEditModal.vue'
import DeleteModal from '@/components/generic/DeleteModal.vue'
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

// The reaffiliation awaiting delete confirmation, plus the state DeleteModal
// renders while the request is in flight.
const deleteTarget = ref(null)
const deleting = ref(false)
const deleteError = ref('')

// Restore has no confirmation step, so the row's own button carries the busy
// state — holds the `_id` of the record currently being restored.
const restoringId = ref(null)

const canRead = computed(() => auth.can('read:all'))
const canEdit = computed(() => auth.can('update:all', 'update:reaff'))
const canDelete = computed(() => auth.can('delete:all', 'delete:reaff'))
// The restore endpoint requires all three permissions, not any one of them.
const canRestore = computed(
  () => auth.can('read:all') && auth.can('update:all') && auth.can('delete:all')
)
const hasAnyAction = computed(() => canEdit.value || canDelete.value || canRestore.value)

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
    result.value = await api.getAllReaffiliations({ page: page.value })
  } catch (e) {
    result.value = null
    error.value = e.detail
  } finally {
    loading.value = false
  }
}

function editReaff(reaff) {
  editError.value = ''
  editTarget.value = reaff
}

function cancelEdit() {
  editTarget.value = null
  editError.value = ''
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

// API timestamps are ISO date-times; show them in the viewer's locale.
function formatDateTime(value) {
  if (!value) return value
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// The four fields PATCH /reaffiliations/reaff/{id} accepts. Everything else on
// the record — the member, the semester — identifies it and is fixed.
const reaffFields = [
  {
    key: 'degree_id',
    label: 'Degree ID',
    type: 'number',
    min: 1,
    placeholder: '12',
    hint: 'Numeric ID of the degree program, as listed under Manage → Degree Programs.',
  },
  {
    key: 'year_level',
    label: 'Year level',
    type: 'string',
    placeholder: '3',
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
  { key: '_id', label: 'Reaff ID', cellClass: 'figure' },
  { key: 'dssoc_id', label: 'DSSOC ID', cellClass: 'figure' },
  { key: 'year', label: 'Semester', cellClass: 'figure', format: (_v, row) => semesterOf(row) },
  { key: 'degree_id', label: 'Degree ID', cellClass: 'figure' },
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

// Edit and Delete apply to an active record; a deleted one can only be
// restored.
const rowActions = computed(() => [
  {
    key: 'edit',
    label: 'Edit',
    icon: 'edit',
    show: (r) => canEdit.value && !r.is_deleted,
    ariaLabel: (r) => `Edit reaffiliation ${r._id}`,
    onClick: editReaff,
  },
  {
    key: 'delete',
    label: 'Delete',
    icon: 'delete',
    danger: true,
    show: (r) => canDelete.value && !r.is_deleted,
    ariaLabel: (r) => `Delete reaffiliation ${r._id}`,
    onClick: askDeleteReaff,
  },
  {
    key: 'restore',
    label: (r) => (restoringId.value === r._id ? 'Restoring…' : 'Restore'),
    icon: 'restore_from_trash',
    accent: true,
    disabled: (r) => restoringId.value === r._id,
    show: (r) => canRestore.value && r.is_deleted,
    ariaLabel: (r) => `Restore reaffiliation ${r._id}`,
    onClick: restoreReaff,
  },
])

// Filters the loaded page. Server-side search is not exposed yet.
const rows = computed(() => {
  const list = result.value?.data ?? []
  const q = search.value.trim().toLowerCase()
  return list.filter((r) => {
    if (status.value === 'active' && r.is_deleted) return false
    if (status.value === 'deleted' && !r.is_deleted) return false
    if (!q) return true
    return [
      r._id,
      r.dssoc_id,
      semesterOf(r),
      r.degree_id,
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
          placeholder="Reaff ID, DSSOC ID, semester, designation"
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
      :actions="rowActions"
      :show-actions="hasAnyAction"
      :empty-text="
        search || status !== 'all'
          ? 'No reaffiliation on this page matches those filters. Try another page or clear them.'
          : 'No reaffiliations recorded yet.'
      "
    >
      <!-- The admin endpoint also returns deleted records; flag them so they
           are not mistaken for active ones. -->
      <template #cell:_id="{ row, value }">
        {{ value }}
        <span v-if="row.is_deleted" class="tag figure">Deleted</span>
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
    <strong>{{ deleteTarget.dssoc_id }}</strong>
    (<span class="figure">reaff {{ deleteTarget._id }}</span>)? It will drop out
    of the member's history and the semester summaries. It stays listed here as
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
</style>
