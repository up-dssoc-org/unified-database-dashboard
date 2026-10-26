<script setup>
import { computed, inject, onMounted, ref, watch } from 'vue'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { toast } from '../../components/generic/useToast'
import DataTable from '@/components/table/DataTable.vue'
import TablePager from '@/components/table/TablePager.vue'
import AddEditModal from '@/components/generic/AddEditModal.vue'
import DeleteModal from '@/components/generic/DeleteModal.vue'
import OptionPickerModal from '@/components/generic/OptionPickerModal.vue'
import { useDebounced } from '@/components/generic/useDebounced'
import posthog from 'posthog-js'

const isPostHogConfigured = inject('isPostHogConfigured')
const auth = useAuthStore();

const page = ref(1)
const result = ref(null)
const loading = ref(true)
const error = ref('')
// The box edits `search`; the list follows `query`, which only catches up once
// typing has paused for a second.
const search = ref('')
const query = useDebounced(() => search.value.trim())

// Add-user modal, plus the state AddEditModal renders while the create runs.
const adding = ref(false)
const creating = ref(false)
const createError = ref('')

// The user open in the edit modal, plus the state AddEditModal renders while
// the save runs.
const editTarget = ref(null)
const saving = ref(false)
const editError = ref('')

// The role picker stacked over the edit modal. It chooses a set, so it stays
// open until the user is done with it.
const pickingRoles = ref(false)
const rolePage = ref(1)
const roleResult = ref(null)
const rolesLoading = ref(false)
const rolesError = ref('')
// Every role fetched so far, keyed by `role_id`. The user record carries only
// the IDs, so this is what turns them into named chips — including the roles
// that are not on the page the picker happens to be showing.
const rolesById = ref({})

// The user awaiting delete confirmation, plus the state DeleteModal renders
// while the request is in flight.
const deleteTarget = ref(null)
const deleting = ref(false)
const deleteError = ref('')

// Restore has no confirmation step, so the row's own button carries the busy
// state — holds the `_id` of the account currently being restored.
const restoringId = ref(null)

const canRead = computed(() => auth.can('read:all'))
const canCreate = computed(() => auth.can('create:all'))
const canEdit = computed(() => auth.can('update:all', 'update:user'))
const canDelete = computed(() => auth.can('delete:all', 'delete:user'))
// The restore endpoint requires all three permissions, not any one of them.
const canRestore = computed(
  () => auth.can('read:all') && auth.can('update:all') && auth.can('delete:all')
)
const hasAnyAction = computed(() => canEdit.value || canDelete.value || canRestore.value)

onMounted(load)
watch(page, load)
// A new search starts over from page 1; when the list is already there, the
// page watcher will not fire, so the load is called directly.
watch(query, () => {
  if (page.value === 1) load()
  else page.value = 1
})

// Searching quickly can leave an older request still in flight; only the
// latest one is allowed to land.
let loadRequest = 0

async function load() {
  if (!canRead.value) {
    loading.value = false
    error.value = 'Your account needs read:all to see users.'
    return
  }
  const ticket = ++loadRequest
  loading.value = true
  error.value = ''
  try {
    const res = await api.getUsers({ page: page.value, search: query.value || null })
    if (ticket === loadRequest) result.value = res
  } catch (e) {
    if (ticket !== loadRequest) return
    result.value = null
    error.value = e.detail
  } finally {
    if (ticket === loadRequest) loading.value = false
  }
}

function addUser() {
  createError.value = ''
  adding.value = true
}

function cancelAdd() {
  adding.value = false
  createError.value = ''
}

async function createUser({ username, password }) {
  creating.value = true
  createError.value = ''
  try {
    await api.addUser(username, password)
    if (isPostHogConfigured) posthog.capture('user_account_created')
    toast.success("User created!")
    adding.value = false
    await load()
  } catch (e) {
    // Kept in the modal so the typed values survive and can be retried.
    createError.value = e?.detail || 'Failed to add user.'
    toast.error("Failed to add user")
  } finally {
    creating.value = false
  }
}

function askDeleteUser(user) {
  deleteError.value = ''
  deleteTarget.value = user
}

function cancelDelete() {
  deleteTarget.value = null
  deleteError.value = ''
}

async function confirmDelete() {
  const user = deleteTarget.value
  if (!user) return
  deleting.value = true
  deleteError.value = ''
  try {
    await api.deleteUser(user._id)
    if (isPostHogConfigured) posthog.capture('user_account_deleted')
    deleteTarget.value = null
    toast.warning('User deleted!')
    // The account stays on the page flagged as deleted, with Restore offered
    // in place of Delete.
    await load()
  } catch (e) {
    // Kept in the modal so the user stays on screen and can be retried.
    deleteError.value = e?.detail || 'Failed to delete user.'
    toast.error('Failed to delete user')
  } finally {
    deleting.value = false
  }
}

async function restoreUser(user) {
  if (!user || restoringId.value !== null) return
  restoringId.value = user._id
  try {
    await api.restoreUser(user._id)
    if (isPostHogConfigured) posthog.capture('user_account_restored')
    toast.success('User restored!')
    await load()
  } catch (e) {
    toast.error(e?.detail || 'Failed to restore user')
  } finally {
    restoringId.value = null
  }
}

function editUser(user) {
  editError.value = ''
  editTarget.value = user
  // Loaded with the modal rather than with the picker so the roles field can
  // name the user's roles straight away instead of showing bare IDs.
  loadRoles()
}

function cancelEdit() {
  editTarget.value = null
  editError.value = ''
  pickingRoles.value = false
}

async function saveUser(values) {
  const user = editTarget.value
  if (!user) return
  saving.value = true
  editError.value = ''
  try {
    // `role_ids` is the whole assignment, not an addition to it: an empty list
    // strips the user's roles.
    const role_ids = idsOf(values.role_ids)
    await api.updateUser(user._id, { username: values.username, role_ids })
    if (isPostHogConfigured) {
      posthog.capture('user_account_updated', { role_count: role_ids.length })
    }
    editTarget.value = null
    toast.success('User updated!')
    await load()
  } catch (e) {
    // Kept in the modal so the edits survive and can be retried.
    editError.value = e?.detail || 'Failed to save user.'
    toast.error('Failed to update user')
  } finally {
    saving.value = false
  }
}

// Paging the picker quickly can leave an older request still in flight; only
// the latest one is allowed to land.
let rolesRequest = 0

const indexRoles = (list) => {
  for (const role of list ?? []) rolesById.value[role.role_id] = role
}

async function loadRoles() {
  const ticket = ++rolesRequest
  rolesLoading.value = true
  rolesError.value = ''
  try {
    const res = await api.getUserRoles({ page: rolePage.value })
    if (ticket !== rolesRequest) return
    roleResult.value = res
    indexRoles(res?.data)
    indexOtherRolePages(res)
  } catch (e) {
    if (ticket !== rolesRequest) return
    roleResult.value = null
    rolesError.value = e?.detail || 'Could not load user roles.'
  } finally {
    if (ticket === rolesRequest) rolesLoading.value = false
  }
}

// An account can hold a role from any page of the list, and a chip that cannot
// name its role is not much use, so the pages the picker has not been to are
// fetched once into the index. Nothing on screen waits on this: the picker
// renders the page it already has, and the chips fill in as it lands.
let roleIndexDone = false

async function indexOtherRolePages(firstPage) {
  const pages = firstPage?.total_pages ?? 1
  if (roleIndexDone || pages <= 1) return
  roleIndexDone = true
  for (let p = 1; p <= pages; p += 1) {
    if (p === firstPage.page) continue
    try {
      const res = await api.getUserRoles({ page: p })
      indexRoles(res?.data)
    } catch {
      // Leave the rest for the next open; the chips fall back to the ID.
      roleIndexDone = false
      return
    }
  }
}

function openRolePicker() {
  pickingRoles.value = true
  // The edit modal already loaded page 1; only a page left over from an
  // earlier open, or a load that failed, needs a fetch here.
  if (rolePage.value !== 1 || !roleResult.value) {
    rolePage.value = 1
    loadRoles()
  }
}

function changeRolePage(next) {
  rolePage.value = next
  loadRoles()
}

// Row identity in the picker. The PATCH takes the numeric `role_id`, so that
// is what the selection is keyed and emitted by.
const roleKey = (r) => r?.role_id

/**
 * The role IDs held by the roles field. A chips field seeds itself from the
 * record as text, so they are read back as numbers — both to match the
 * picker's keys and because the API takes integers.
 */
function idsOf(value) {
  if (!Array.isArray(value)) return []
  return value.map(Number).filter((n) => Number.isInteger(n))
}

const roleLabel = (role) => role?.role_name || `Role #${role?.role_id}`

/**
 * The chips the roles field renders: the account's role IDs matched against
 * the roles fetched from `/user-roles`. An ID with no match yet — its page of
 * the list has not landed, or the role has since been deleted — keeps its
 * place as a bare ID rather than disappearing from the account.
 */
function roleChips(value) {
  return idsOf(value).map((id) => ({
    id,
    label: rolesById.value[id] ? roleLabel(rolesById.value[id]) : `Role #${id}`,
    known: Boolean(rolesById.value[id]),
  }))
}

function addRoleId(id, value, set) {
  const ids = idsOf(value)
  if (!ids.includes(id)) set([...ids, id])
}

function removeRoleId(id, value, set) {
  set(idsOf(value).filter((other) => other !== id))
}

/**
 * The roles an account holds. The list endpoint spells the assignment
 * `user_role_ids` and the PATCH takes it as `role_ids`, so both are read and
 * the form is seeded under the name the PATCH wants.
 */
const userRoleIds = (user) => idsOf(user?.user_role_ids ?? user?.role_ids)

// The two fields PATCH /user/{user_id} accepts. AddEditModal seeds the form
// from `values` by key, so the record is remapped on open.
const editValues = computed(() =>
  editTarget.value
    ? {
        username: editTarget.value.username,
        role_ids: userRoleIds(editTarget.value),
      }
    : null
)

const userFields = [
  {
    key: 'username',
    label: 'Username',
    type: 'string',
    required: true,
    placeholder: 'johndoe123',
  },
  {
    key: 'password',
    label: 'Password',
    type: 'password',
    required: true,
  },
]

// The add form asks for a password the PATCH has no place for, so the edit
// form takes the username field and adds the roles picker.
const editFields = [
  userFields[0],
  {
    // Rendered through the `field:role_ids` slot as chips plus a picker; the
    // type still makes the payload a list, so clearing it reads as "no roles".
    key: 'role_ids',
    label: 'Roles',
    type: 'chips',
    hint: 'The roles this account holds. Saving replaces them with the ones shown here.',
  },
]

const roleColumns = [
  { key: 'role_id', label: 'Role ID', cellClass: 'figure' },
  { key: 'role_name', label: 'Role' },
  { key: 'description', label: 'Description' },
]

// API timestamps are ISO date-times; show them in the viewer's locale.
function formatDateTime(value) {
  if (!value) return value
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// Delete and Restore are mutually exclusive per row: an active account can be
// edited or deleted, a deleted one can be restored.
const rowActions = computed(() => [
  {
    key: 'edit',
    label: 'Edit',
    icon: 'edit',
    show: (u) => canEdit.value && !u.is_deleted,
    ariaLabel: (u) => `Edit ${u.username}`,
    onClick: editUser,
  },
  {
    key: 'delete',
    label: 'Delete',
    icon: 'delete',
    danger: true,
    show: (u) => canDelete.value && !u.is_deleted,
    ariaLabel: (u) => `Delete ${u.username}`,
    onClick: askDeleteUser,
  },
  {
    key: 'restore',
    label: (u) => (restoringId.value === u._id ? 'Restoring…' : 'Restore'),
    icon: 'restore_from_trash',
    accent: true,
    disabled: (u) => restoringId.value === u._id,
    show: (u) => canRestore.value && u.is_deleted,
    ariaLabel: (u) => `Restore ${u.username}`,
    onClick: restoreUser,
  },
])

const columns = [
  { key: 'username', label: 'Username' },
  { key: 'last_login', label: 'Last Login', cellClass: 'figure', format: formatDateTime, empty: 'Never' },
  { key: 'metadata.created_at', label: 'Created', cellClass: 'figure', format: formatDateTime },
]

const rows = computed(() => result.value?.data ?? [])

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
      <h1>Users</h1>
      <p class="muted sub">Accounts that can sign in to the dashboard.</p>
    </div>
    <div class="controls">
      <div class="search">
        <label for="q">Search</label>
        <input id="q" v-model="search" type="search" placeholder="Username" />
      </div>
      <button v-if="canCreate" class="btn" @click="addUser">
        <span class="material-symbols-outlined">add</span>
        Add user
      </button>
    </div>
  </header>

  <p v-if="error" class="notice" role="alert">{{ error }}</p>
  <p v-else-if="loading" class="muted">Loading users…</p>

  <template v-else-if="result">
    <p class="count">
      <span class="figure">{{ result.total }}</span> users<span v-if="query">
        match “{{ query }}”</span
      ><span v-if="result.total">
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
        query
          ? 'No user matches that search.'
          : 'No users recorded yet.'
      "
    >
      <!-- The admin endpoint also returns deleted accounts; flag them so they
           are not mistaken for active ones. -->
      <template #cell:username="{ row, value }">
        {{ value }}
        <span v-if="row.is_deleted" class="tag figure">Deleted</span>
      </template>
    </DataTable>

    <TablePager v-model:page="page" :total-pages="result.total_pages" />
  </template>

  <AddEditModal
    v-if="adding"
    title="Add user"
    description="Creates a new account that can sign in to the dashboard."
    submit-label="Add user"
    busy-label="Adding…"
    :fields="userFields"
    :busy="creating"
    :error="createError"
    @close="cancelAdd"
    @submit="createUser"
  />

  <AddEditModal
    v-if="editTarget"
    title="Edit user"
    :description="`Updating ${editTarget.username}.`"
    submit-label="Save user"
    :fields="editFields"
    :values="editValues"
    :busy="saving"
    :error="editError"
    @close="cancelEdit"
    @submit="saveUser"
  >
    <template #field:role_ids="{ id, value, set, disabled, invalid, describedby }">
      <div class="roles-field" :class="{ invalid, disabled }">
        <span
          v-for="chip in roleChips(value)"
          :key="chip.id"
          class="chip figure"
          :class="{ unknown: !chip.known }"
          :title="rolesById[chip.id]?.description"
        >
          {{ chip.label }}
          <button
            v-if="!disabled"
            type="button"
            class="chip-remove"
            :aria-label="`Remove ${chip.label}`"
            @click="removeRoleId(chip.id, value, set)"
          >
            <span class="material-symbols-outlined">close</span>
          </button>
        </span>

        <span v-if="!roleChips(value).length" class="muted no-roles">
          {{ rolesLoading ? 'Loading roles…' : 'No roles assigned' }}
        </span>

        <button
          :id="id"
          type="button"
          class="roles-pick"
          :disabled="disabled"
          aria-haspopup="dialog"
          :aria-invalid="invalid ? 'true' : undefined"
          :aria-describedby="describedby"
          @click="openRolePicker"
        >
          <span class="material-symbols-outlined" aria-hidden="true">edit</span>
          {{ roleChips(value).length ? 'Change' : 'Choose roles' }}
        </button>
      </div>

      <OptionPickerModal
        v-if="pickingRoles"
        multiple
        title="Choose roles"
        description="Pick every role this account should have. Saving the user applies the choice."
        :columns="roleColumns"
        :rows="roleResult?.data ?? []"
        :row-key="roleKey"
        :selected-keys="idsOf(value)"
        :page="rolePage"
        :total-pages="roleResult?.total_pages ?? 1"
        :total="roleResult?.total ?? null"
        :loading="rolesLoading"
        :error="rolesError"
        :option-label="roleLabel"
        empty-text="No user roles recorded yet."
        @update:page="changeRolePage"
        @select="(role) => addRoleId(role.role_id, value, set)"
        @deselect="(role) => removeRoleId(role.role_id, value, set)"
        @close="pickingRoles = false"
      />
    </template>
  </AddEditModal>

  <DeleteModal
    v-if="deleteTarget"
    title="Delete user"
    confirm-label="Delete user"
    :busy="deleting"
    :error="deleteError"
    @close="cancelDelete"
    @confirm="confirmDelete"
  >
    Delete <strong>{{ deleteTarget.username }}</strong>
    (<span class="figure">user {{ deleteTarget._id }}</span>)? The account will
    no longer be able to sign in. It stays listed here as deleted and can be
    restored.
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

/* Reads as one control, like the chips input the other forms use: the box
   carries the border, the roles sit in it as chips, and the button at the end
   opens the picker. */
.roles-field {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.45rem;
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: 2px;
  min-height: 2.45rem;
}

.roles-field:focus-within {
  border-color: var(--maroon);
}

.roles-field.invalid {
  border-color: #c0392b;
}

.roles-field.disabled {
  background: var(--canvas);
}

/* Matches the permission chips the tables render. */
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  font-size: 0.72rem;
  padding: 0.1rem 0.2rem 0.1rem 0.45rem;
  background: var(--canvas);
  border: 1px solid var(--rule);
  border-radius: 2px;
  color: var(--ink);
}

.roles-field.disabled .chip {
  padding-right: 0.45rem;
  color: var(--slate);
}

/* A role the fetched list does not account for — shown, but not vouched for. */
.chip.unknown {
  border-style: dashed;
  color: var(--slate);
}

.chip-remove {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: var(--slate);
  display: flex;
  align-items: center;
  border-radius: 2px;
  transition: background 0.12s, color 0.12s;
}

.chip-remove:hover {
  background: var(--rule);
  color: var(--maroon);
}

.chip-remove .material-symbols-outlined {
  font-size: 0.9rem;
}

.no-roles {
  font-size: 0.82rem;
}

.roles-pick {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  margin-left: auto;
  font: inherit;
  font-size: 0.78rem;
  padding: 0.2rem 0.5rem;
  border: 1px solid var(--rule);
  border-radius: 2px;
  background: transparent;
  color: var(--ink);
  cursor: pointer;
  white-space: nowrap;
}

.roles-pick:hover:not(:disabled) {
  border-color: var(--maroon);
  color: var(--maroon);
}

.roles-pick:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.roles-pick .material-symbols-outlined {
  font-size: 0.95rem;
}
</style>
