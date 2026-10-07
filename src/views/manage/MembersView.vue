<script setup>
import { computed, inject, onMounted, ref, watch } from 'vue'
import { api, latestSemester, semesterCode } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import DataTable from '@/components/table/DataTable.vue'
import TablePager from '@/components/table/TablePager.vue'
import SingleReaffiliation from '@/components/reaffiliation/SingleReaffiliation.vue'
import AddEditModal from '@/components/generic/AddEditModal.vue'
import DeleteModal from '@/components/generic/DeleteModal.vue'
import posthog from 'posthog-js'

const isPostHogConfigured = inject('isPostHogConfigured')
const auth = useAuthStore();

const semesters = ref([])
const selected = ref(null)
const page = ref(1)
const result = ref(null)
const loading = ref(true)
const error = ref('')
const search = ref('')

const canRead = computed(() => auth.can('read:all', 'read:member'))
const canEdit = computed(() => auth.can('update:all', 'update:member'))
const canDelete = computed(() => auth.can('delete:all', 'delete:member'))
const hasAnyAction = computed(() => canRead.value || canEdit.value || canDelete.value)
const viewRecord = ref(null)

const editTarget = ref(null)
const saving = ref(false)
const editError = ref('')

// The member awaiting delete confirmation, plus the state DeleteModal renders
// while the request is in flight.
const deleteTarget = ref(null)
const deleting = ref(false)
const deleteError = ref('')

onMounted(async () => {
  try {
    const meta = await api.semesters()
    semesters.value = [...meta.data].sort(
      (a, b) => b.year - a.year || b.semester.localeCompare(a.semester)
    )
    const latest = latestSemester(meta.data)
    selected.value = latest ? semesterCode(latest.year, latest.semester) : '2425B'
  } catch {
    selected.value = '2425B'
  }
})

watch(selected, () => {
  page.value = 1
  load()
})
watch(page, load)

// NOTE: a special /admin/members endpoint should be constructed
// wherein data fetched is based on the query WITHOUT including 
// is_deleted = False
async function load() {
  if (!selected.value) return
  if (!canRead.value) {
    loading.value = false
    error.value = 'Your account needs read:member or read:all to see this list.'
    return
  }
  loading.value = true
  error.value = ''
  try {
    result.value = await api.getMembers({
      year: selected.value.slice(0, 4),
      sem: selected.value.slice(4),
      page: page.value,
    })
  } catch (e) {
    result.value = null
    error.value = e.detail
  } finally {
    loading.value = false
  }
}

function viewMember(member) {
  viewRecord.value = { dssoc_id: member._id, member }
}

function editMember(member) {
  editError.value = ''
  editTarget.value = member
}

function cancelEdit() {
  editTarget.value = null
  editError.value = ''
}

async function saveMember(values) {
  const member = editTarget.value
  if (!member) return
  saving.value = true
  editError.value = ''
  try {
    await api.editMember(member._id, values)
    if (isPostHogConfigured) posthog.capture('member_updated')
    editTarget.value = null
    await load()
  } catch (e) {
    // Kept in the modal so the edits survive and can be retried.
    editError.value = e?.detail || 'Failed to save member.'
  } finally {
    saving.value = false
  }
}

function askDeleteMember(member) {
  deleteError.value = ''
  deleteTarget.value = member
}

function cancelDelete() {
  deleteTarget.value = null
  deleteError.value = ''
}

async function confirmDelete() {
  const member = deleteTarget.value
  if (!member) return
  deleting.value = true
  deleteError.value = ''
  try {
    await api.deleteMember(member._id)
    if (isPostHogConfigured) posthog.capture('member_deleted')
    deleteTarget.value = null
    await load()
  } catch (e) {
    // Kept in the modal so the member stays on screen and can be retried.
    deleteError.value = e?.detail || 'Failed to delete member.'
  } finally {
    deleting.value = false
  }
}

const fullName = (m) =>
  [m?.first_name, m?.middle_name, m?.last_name, m?.suffix].filter(Boolean).join(' ') || m?._id

const columns = [
  { key: '_id', label: 'DSSOC ID', cellClass: 'figure' },
  { key: 'student_number', label: 'Student Number', cellClass: 'figure' },
  { key: 'last_name', label: 'Last Name' },
  { key: 'first_name', label: 'First Name' },
  { key: 'middle_name', label: 'Middle Name' },
  { key: 'personal_email', label: 'Personal Email' },
  { key: 'up_mail', label: 'UP Mail' },
]

// NOTE: `social_media` and `user_id` are to be incorporated as separate
// features
const memberFields = [
  {
    key: 'student_number',
    label: 'Student number',
    type: 'string',
    placeholder: '2020-12345',
  },
  { key: 'last_name', label: 'Last name', type: 'string', required: true },
  { key: 'first_name', label: 'First name', type: 'string', required: true },
  {
    key: 'middle_name',
    label: 'Middle name',
    type: 'string',
    hint: 'Middle name or initial. Optional.',
  },
  { key: 'suffix', label: 'Suffix', type: 'string', placeholder: 'Jr.' },
  { key: 'pronouns', label: 'Pronouns', type: 'string', placeholder: 'they/them' },
  {
    key: 'birthday',
    label: 'Birthday',
    type: 'string',
    placeholder: '01/01/2000',
    hint: 'MM/DD/YYYY.',
  },
  {
    key: 'contact_number',
    label: 'Contact number',
    type: 'string',
    placeholder: '0917 123 4567',
  },
  {
    key: 'personal_email',
    label: 'Personal email',
    type: 'string',
    placeholder: 'member@example.com',
  },
  {
    key: 'up_mail',
    label: 'UP mail',
    type: 'string',
    placeholder: 'member@up.edu.ph',
  },
]

const rowActions = computed(() => [
  {
    key: 'view',
    label: 'View',
    icon: 'visibility',
    show: canRead.value,
    ariaLabel: (m) => `View ${fullName(m)}`,
    onClick: viewMember,
  },
  {
    key: 'edit',
    label: 'Edit',
    icon: 'edit',
    show: canEdit.value,
    ariaLabel: (m) => `Edit ${fullName(m)}`,
    onClick: editMember,
  },
  {
    key: 'delete',
    label: 'Delete',
    icon: 'delete',
    danger: true,
    show: canDelete.value,
    ariaLabel: (m) => `Delete ${fullName(m)}`,
    onClick: askDeleteMember,
  },
])

// Filters the loaded page. Server-side search is not exposed yet.
const rows = computed(() => {
  const list = result.value?.data ?? []
  const q = search.value.trim().toLowerCase()
  if (!q) return list
  return list.filter((m) =>
    [m._id, m.student_number, m.last_name, m.first_name, m.middle_name, m.personal_email, m.up_mail]
      .some((v) => String(v ?? '').toLowerCase().includes(q))
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
      <h1>Members</h1>
      <p class="muted sub">Members who first joined on this selected semester.</p>
    </div>
    <div class="controls">
      <div>
        <label for="sem">Semester</label>
        <select id="sem" v-model="selected">
          <option v-for="s in semesters" :key="`${s.year}${s.semester}`" :value="`${s.year}${s.semester}`">
            {{ s.year }}{{ s.semester }}
          </option>
          <option v-if="!semesters.length" :value="selected">{{ selected }}</option>
        </select>
      </div>
      <div class="search">
        <label for="q">Find on this page</label>
        <input id="q" v-model="search" type="search" placeholder="Name, DSSOC ID, student number, email" />
      </div>
    </div>
  </header>

  <p v-if="error" class="notice" role="alert">{{ error }}</p>
  <p v-else-if="loading" class="muted">Loading members…</p>

  <template v-else-if="result">
    <p class="count">
      <span class="figure">{{ result.total }}</span> members in {{ selected }}<span v-if="result.total">
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
        search
          ? 'No one on this page matches that search. Try another page or clear the search.'
          : 'No members recorded for this semester yet.'
      "
    />

    <TablePager v-model:page="page" :total-pages="result.total_pages" />
  </template>

  <SingleReaffiliation
    v-if="viewRecord"
    :record="viewRecord"
    @close="viewRecord = null"
  />

  <AddEditModal
    v-if="editTarget"
    title="Edit member"
    :description="`Updating ${fullName(editTarget)} (${editTarget._id}).`"
    submit-label="Save member"
    :fields="memberFields"
    :values="editTarget"
    :busy="saving"
    :error="editError"
    @close="cancelEdit"
    @submit="saveMember"
  />

  <DeleteModal
    v-if="deleteTarget"
    title="Delete member"
    confirm-label="Delete member"
    :busy="deleting"
    :error="deleteError"
    @close="cancelDelete"
    @confirm="confirmDelete"
  >
    Delete <strong>{{ fullName(deleteTarget) }}</strong>
    (<span class="figure">{{ deleteTarget._id }}</span>)? Their profile and
    reaffiliation history will no longer appear in the dashboard.
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
</style>
