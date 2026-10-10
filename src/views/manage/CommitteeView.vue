<script setup>
import { computed, onMounted, ref } from 'vue'
import { api } from '@/api/client'
import DataTable from '@/components/table/DataTable.vue'
import DeleteModal from '@/components/generic/DeleteModal.vue'
import { toast } from '@/components/generic/useToast'
import { useAuthStore } from '@/stores/auth'

const result = ref(null)
const loading = ref(true)
const error = ref('')
const search = ref('')
// The admin list is the only one that returns soft-deleted records, so the
// page can be narrowed to just the active or just the deleted ones.
const status = ref('all')

// The committee awaiting delete confirmation, plus the state DeleteModal
// renders while the request is in flight.
const deleteTarget = ref(null)
const deleting = ref(false)
const deleteError = ref('')

// Restore has no confirmation step, so the row's own button carries the busy
// state — holds the `_id` of the record currently being restored.
const restoringId = ref(null)

const auth = useAuthStore()

const canRead = computed(() => auth.can('read:all'))
const canCreate = computed(() => auth.can('create:all'))
const canEdit = computed(() => auth.can('update:all'))
const canDelete = computed(() => auth.can('delete:all'))
// The restore endpoint requires all three permissions, not any one of them.
const canRestore = computed(
  () => auth.can('read:all') && auth.can('update:all') && auth.can('delete:all')
)
const hasAnyAction = computed(() => canEdit.value || canDelete.value || canRestore.value)

onMounted(load)

async function load() {
  if (!canRead.value) {
    loading.value = false
    error.value = 'Your account needs read:all to see committees.'
    return
  }
  loading.value = true
  error.value = ''
  try {
    result.value = await api.getAllCommittees()
  } catch (e) {
    result.value = null
    error.value = e.detail
  } finally {
    loading.value = false
  }
}

// TODO: open the add-committee modal once it exists.
function addCommittee() {}

// TODO: open the edit-committee modal once it exists.
function editCommittee(committee) {}

function askDeleteCommittee(committee) {
  deleteError.value = ''
  deleteTarget.value = committee
}

function cancelDelete() {
  deleteTarget.value = null
  deleteError.value = ''
}

async function confirmDelete() {
  const committee = deleteTarget.value
  if (!committee) return
  deleting.value = true
  deleteError.value = ''
  try {
    // NOTE: the API has no top-level committee delete yet, so this currently
    // comes back 404 and the message lands in the modal.
    await api.deleteCommittee(committee._id)
    deleteTarget.value = null
    toast.warning('Committee deleted!')
    // The delete is a soft one: the record stays on the page flagged as
    // deleted, with Restore offered in place of Edit and Delete.
    await load()
  } catch (e) {
    // Kept in the modal so the record stays on screen and can be retried.
    deleteError.value = e?.detail || 'Failed to delete committee.'
    toast.error('Failed to delete committee')
  } finally {
    deleting.value = false
  }
}

async function restoreCommittee(committee) {
  if (!committee || restoringId.value !== null) return
  restoringId.value = committee._id
  try {
    await api.restoreCommittee(committee._id)
    toast.success('Committee restored!')
    await load()
  } catch (e) {
    toast.error(e?.detail || 'Failed to restore committee')
  } finally {
    restoringId.value = null
  }
}

const categoryNum = (c) => String(c?.category_num ?? '').padStart(2, '0')

const columns = [
  { key: 'category_num', label: 'Category', cellClass: 'figure', format: (_v, c) => categoryNum(c) },
  { key: '_id', label: 'Initials', cellClass: 'figure' },
  { key: 'name', label: 'Name' },
]

// Edit and Delete apply to an active record; a deleted one can only be
// restored.
const rowActions = computed(() => [
  {
    key: 'edit',
    label: 'Edit',
    icon: 'edit',
    show: (c) => canEdit.value && !c.is_deleted,
    ariaLabel: (c) => `Edit ${c.name}`,
    onClick: editCommittee,
  },
  {
    key: 'delete',
    label: 'Delete',
    icon: 'delete',
    danger: true,
    show: (c) => canDelete.value && !c.is_deleted,
    ariaLabel: (c) => `Delete ${c.name}`,
    onClick: askDeleteCommittee,
  },
  {
    key: 'restore',
    label: (c) => (restoringId.value === c._id ? 'Restoring…' : 'Restore'),
    icon: 'restore_from_trash',
    accent: true,
    disabled: (c) => restoringId.value === c._id,
    show: (c) => canRestore.value && c.is_deleted,
    ariaLabel: (c) => `Restore ${c.name}`,
    onClick: restoreCommittee,
  },
])

const rows = computed(() => {
  const list = (result.value?.data ?? [])
    .slice()
    .sort((a, b) => categoryNum(a).localeCompare(categoryNum(b)) || a._id.localeCompare(b._id))
  const q = search.value.trim().toLowerCase()
  return list.filter((c) => {
    if (status.value === 'active' && c.is_deleted) return false
    if (status.value === 'deleted' && !c.is_deleted) return false
    if (!q) return true
    return [c._id, c.name, c.category_num].some((v) =>
      String(v ?? '').toLowerCase().includes(q)
    )
  })
})
</script>

<template>
  <header class="head">
    <div>
      <h1>Committees</h1>
      <p class="muted sub">
        Committees members can be assigned to, including the ones that have been deleted.
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
        <label for="q">Find committee</label>
        <input id="q" v-model="search" type="search" placeholder="Initials, name, category" />
      </div>
      <button v-if="canCreate" class="btn" @click="addCommittee">
        <span class="material-symbols-outlined">add</span>
        Add committee
      </button>
    </div>
  </header>

  <p v-if="error" class="notice" role="alert">{{ error }}</p>
  <p v-else-if="loading" class="muted">Loading committees…</p>

  <template v-else-if="result">
    <p class="count">
      <span class="figure">{{ rows.length }}</span> committees<span
        v-if="search || status !== 'all'"
      >
        match</span
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
          ? 'No committee matches those filters.'
          : 'No committees recorded yet.'
      "
    >
      <!-- The admin endpoint also returns deleted records; flag them so they
           are not mistaken for active ones. -->
      <template #cell:_id="{ row, value }">
        {{ value }}
        <span v-if="row.is_deleted" class="tag figure">Deleted</span>
      </template>
    </DataTable>
  </template>

  <DeleteModal
    v-if="deleteTarget"
    title="Delete committee"
    confirm-label="Delete committee"
    :busy="deleting"
    :error="deleteError"
    @close="cancelDelete"
    @confirm="confirmDelete"
  >
    Delete <strong>{{ deleteTarget.name }}</strong>
    (<span class="figure">{{ deleteTarget._id }}</span>)? Members already
    assigned to it keep their records, but it can no longer be assigned. It
    stays listed here as deleted and can be restored.
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
  min-width: 15rem;
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
