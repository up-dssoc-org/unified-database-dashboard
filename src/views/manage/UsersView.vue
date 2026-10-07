<script setup>
import { computed, inject, onMounted, ref, watch } from 'vue'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { toast } from '../../components/generic/useToast'
import DataTable from '@/components/table/DataTable.vue'
import TablePager from '@/components/table/TablePager.vue'
import AddEditModal from '@/components/generic/AddEditModal.vue'
import posthog from 'posthog-js'

const isPostHogConfigured = inject('isPostHogConfigured')
const auth = useAuthStore();

const page = ref(1)
const result = ref(null)
const loading = ref(true)
const error = ref('')
const search = ref('')

// Add-user modal, plus the state AddEditModal renders while the create runs.
const adding = ref(false)
const creating = ref(false)
const createError = ref('')

const canRead = computed(() => auth.can('read:all'))
const canCreate = computed(() => auth.can('create:all'))

onMounted(load)
watch(page, load)

async function load() {
  if (!canRead.value) {
    loading.value = false
    error.value = 'Your account needs read:all to see users.'
    return
  }
  loading.value = true
  error.value = ''
  try {
    result.value = await api.getUsers({ page: page.value })
  } catch (e) {
    result.value = null
    error.value = e.detail
  } finally {
    loading.value = false
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

// TODO: add the edit and delete modals once the API exposes user update and
// delete endpoints. The table has no actions column until then.

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

// API timestamps are ISO date-times; show them in the viewer's locale.
function formatDateTime(value) {
  if (!value) return value
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const columns = [
  { key: 'username', label: 'Username' },
  { key: 'last_login', label: 'Last Login', cellClass: 'figure', format: formatDateTime, empty: 'Never' },
  { key: 'metadata.created_at', label: 'Created', cellClass: 'figure', format: formatDateTime },
]

// Filters the loaded page. Server-side search is not exposed yet.
const rows = computed(() => {
  const list = result.value?.data ?? []
  const q = search.value.trim().toLowerCase()
  if (!q) return list
  return list.filter((u) => String(u.username ?? '').toLowerCase().includes(q))
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
      <h1>Users</h1>
      <p class="muted sub">Accounts that can sign in to the dashboard.</p>
    </div>
    <div class="controls">
      <div class="search">
        <label for="q">Find on this page</label>
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
      <span class="figure">{{ result.total }}</span> users<span v-if="result.total">
        · showing {{ firstOnPage }}–{{ lastOnPage }}</span
      >
    </p>

    <DataTable
      :columns="columns"
      :rows="rows"
      row-key="_id"
      :empty-text="
        search
          ? 'No user on this page matches that search. Try another page or clear the search.'
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
