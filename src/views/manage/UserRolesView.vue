<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '@/api/client'
import { auth } from '@/stores/auth'
import DataTable from '@/components/table/DataTable.vue'
import TablePager from '@/components/table/TablePager.vue'
import AddEditModal from '@/components/generic/AddEditModal.vue'
import DeleteModal from '@/components/generic/DeleteModal.vue'
import { toast } from '@/components/generic/useToast'

const page = ref(1)
const result = ref(null)
const loading = ref(true)
const error = ref('')
const search = ref('')

// Add-role modal, plus the state AddEditModal renders while the create runs.
const adding = ref(false)
const creating = ref(false)
const createError = ref('')

// The role open in the edit modal, plus the same pair of states for the save.
const editTarget = ref(null)
const saving = ref(false)
const editError = ref('')

// The role awaiting delete confirmation, plus the state DeleteModal renders
// while the request is in flight.
const deleteTarget = ref(null)
const deleting = ref(false)
const deleteError = ref('')

const canRead = computed(() => auth.can('read:all'))
const canCreate = computed(() => auth.can('create:all'))
const canEdit = computed(() => auth.can('update:all'))
const canDelete = computed(() => auth.can('delete:all'))
const hasAnyAction = computed(() => canEdit.value || canDelete.value)

onMounted(load)
watch(page, load)

async function load() {
  if (!canRead.value) {
    loading.value = false
    error.value = 'Your account needs read:all to see user roles.'
    return
  }
  loading.value = true
  error.value = ''
  try {
    result.value = await api.getUserRoles({ page: page.value })
  } catch (e) {
    result.value = null
    error.value = e.detail
  } finally {
    loading.value = false
  }
}

function addRole() {
  createError.value = ''
  adding.value = true
}

function cancelAdd() {
  adding.value = false
  createError.value = ''
}

async function createRole(values) {
  creating.value = true
  createError.value = ''
  try {
    await api.addUserRole(values)
    adding.value = false
    toast.success("User role created!")
    await load()
  } catch (e) {
    // Kept in the modal so the typed values survive and can be retried.
    createError.value = e?.detail || 'Failed to add user role.'
    toast.error("Failed to add user role")
  } finally {
    creating.value = false
  }
}

function editRole(role) {
  editError.value = ''
  editTarget.value = role
}

function cancelEdit() {
  editTarget.value = null
  editError.value = ''
}

async function saveRole(values) {
  const role = editTarget.value
  if (!role) return
  saving.value = true
  editError.value = ''
  try {
    await api.updateUserRole(role.role_id, values)
    editTarget.value = null
    toast.success("User role updated!")
    await load()
  } catch (e) {
    // Kept in the modal so the edits survive and can be retried.
    editError.value = e?.detail || 'Failed to save user role.'
    toast.error("Failed to update user role")
  } finally {
    saving.value = false
  }
}

function askDeleteRole(role) {
  deleteError.value = ''
  deleteTarget.value = role
}

function cancelDelete() {
  deleteTarget.value = null
  deleteError.value = ''
}

async function confirmDelete() {
  const role = deleteTarget.value
  if (!role) return
  deleting.value = true
  deleteError.value = ''
  try {
    await api.deleteUserRole(role.role_id)
    deleteTarget.value = null
    toast.warning("User role deleted!")
    await load()
  } catch (e) {
    // Kept in the modal so the role stays on screen and can be retried.
    deleteError.value = e?.detail || 'Failed to delete user role.'
    toast.error("Failed to delete user role!")
  } finally {
    deleting.value = false
  }
}

// Row identity for the table. The API addresses a role by its numeric
// `role_id`, which is what the write calls above pass.
const roleKey = (r) => r?._id ?? r?.role_id

// Shared by the add and edit modals: both endpoints take the same three keys.
// `permissions` arrives from the API as an array and the chips field binds to
// one directly, so an edit opens with the existing permissions already chipped.
const roleFields = [
  {
    key: 'role_name',
    label: 'Role name',
    type: 'string',
    required: true,
    placeholder: 'Committee Head',
  },
  {
    key: 'description',
    label: 'Description',
    type: 'string',
    required: true,
    placeholder: 'What this role is for',
  },
  {
    key: 'permissions',
    label: 'Permissions',
    type: 'chips',
    placeholder: 'read:all, update:member',
    hint: 'Type or paste permissions separated by commas. Enter adds the one you are typing.',
  },
]

const columns = [
  { key: 'role_id', label: 'Role ID', cellClass: 'figure' },
  { key: 'role_name', label: 'Role' },
  { key: 'description', label: 'Description' },
  { key: 'permissions', label: 'Permissions' },
]

const rowActions = computed(() => [
  {
    key: 'edit',
    label: 'Edit',
    icon: 'edit',
    show: canEdit.value,
    ariaLabel: (r) => `Edit ${r.role_name}`,
    onClick: editRole,
  },
  {
    key: 'delete',
    label: 'Delete',
    icon: 'delete',
    danger: true,
    show: canDelete.value,
    ariaLabel: (r) => `Delete ${r.role_name}`,
    onClick: askDeleteRole,
  },
])

// Filters the loaded page. Server-side search is not exposed yet.
const rows = computed(() => {
  const list = [...(result.value?.data ?? [])].sort((a, b) => a?.role_id - b?.role_id)
  const q = search.value.trim().toLowerCase()
  if (!q) return list
  return list.filter((r) =>
    [r.role_name, r.description, ...(r.permissions ?? [])].some((v) =>
      String(v ?? '').toLowerCase().includes(q)
    )
  )
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
      <h1>User Roles</h1>
      <p class="muted sub">Roles and the permissions they grant to accounts.</p>
    </div>
    <div class="controls">
      <div class="search">
        <label for="q">Find on this page</label>
        <input id="q" v-model="search" type="search" placeholder="Role, description, permission" />
      </div>
      <button v-if="canCreate" class="btn" @click="addRole">
        <span class="material-symbols-outlined">add</span>
        Add user role
      </button>
    </div>
  </header>

  <p v-if="error" class="notice" role="alert">{{ error }}</p>
  <p v-else-if="loading" class="muted">Loading user roles…</p>

  <template v-else-if="result">
    <p class="count">
      <span class="figure">{{ result.total }}</span> user roles<span v-if="result.total">
        · showing {{ firstOnPage }}–{{ lastOnPage }}</span
      >
    </p>

    <DataTable
      :columns="columns"
      :rows="rows"
      :row-key="roleKey"
      :actions="rowActions"
      :show-actions="hasAnyAction"
      :empty-text="
        search
          ? 'No role on this page matches that search. Try another page or clear the search.'
          : 'No user roles recorded yet.'
      "
    >
      <template #cell:permissions="{ value }">
        <span v-if="value?.length" class="perm-list">
          <span v-for="p in value" :key="p" class="perm-chip figure">{{ p }}</span>
        </span>
        <span v-else class="muted">No permissions assigned</span>
      </template>
    </DataTable>

    <TablePager v-model:page="page" :total-pages="result.total_pages" />
  </template>

  <AddEditModal
    v-if="adding"
    title="Add user role"
    description="Creates a role and the permissions it grants to accounts."
    submit-label="Add user role"
    :fields="roleFields"
    :busy="creating"
    :error="createError"
    @close="cancelAdd"
    @submit="createRole"
  />

  <AddEditModal
    v-if="editTarget"
    title="Edit user role"
    :description="`Updating ${editTarget.role_name}.`"
    submit-label="Save user role"
    :fields="roleFields"
    :values="editTarget"
    :busy="saving"
    :error="editError"
    @close="cancelEdit"
    @submit="saveRole"
  />

  <DeleteModal
    v-if="deleteTarget"
    title="Delete user role"
    confirm-label="Delete user role"
    :busy="deleting"
    :error="deleteError"
    @close="cancelDelete"
    @confirm="confirmDelete"
  >
    Delete <strong>{{ deleteTarget.role_name }}</strong>
    (<span class="figure">role {{ deleteTarget.role_id }}</span>)? Accounts
    assigned to it will lose the permissions it grants.
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

.perm-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.perm-chip {
  font-size: 0.72rem;
  padding: 0.1rem 0.45rem;
  background: var(--canvas);
  border: 1px solid var(--rule);
  border-radius: 2px;
  color: var(--ink);
}
</style>
