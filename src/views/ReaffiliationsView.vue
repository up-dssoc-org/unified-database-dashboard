<script setup>
import { computed, inject, onMounted, ref, watch } from 'vue'
import { api, latestSemester, semesterCode } from '../api/client'
import { auth } from '../stores/auth'
import SingleReaffiliation from '../components/reaffiliation/SingleReaffiliation.vue'
import DataTable from '../components/table/DataTable.vue'
import RowActionMenu from '../components/table/RowActionMenu.vue'
import TablePager from '../components/table/TablePager.vue'
import DeleteModal from '@/components/generic/DeleteModal.vue'
import posthog from 'posthog-js'

const isPostHogConfigured = inject('isPostHogConfigured')

const semesters = ref([])
const selected = ref(null)
const page = ref(1)
const result = ref(null)
const loading = ref(true)
const error = ref('')
const search = ref('')

const canRead = computed(() => auth.can('read:all', 'read:member'))
const canEditMember = computed(() => auth.can('update:all', 'update:member'))
const canEditReaff = computed(() => auth.can('update:all', 'update:reaff'))
const canDelete = computed(() => auth.can('delete:all', 'delete:reaff'))
const hasAnyAction = computed(
  () => canRead.value || canEditMember.value || canEditReaff.value || canDelete.value
)

const viewRecord = ref(null)

const deleteError = ref(null)
const deleteTarget = ref(null)
const deleting = ref(false)

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
    result.value = await api.getReaffiliations({
      year: selected.value.slice(0, 4),
      sem: selected.value.slice(4),
      include_member_data: true,
      page: page.value,
    })
  } catch (e) {
    result.value = null
    error.value = e.detail
  } finally {
    loading.value = false
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
  const reaff = deleteTarget?.value
  if (!reaff) return
  deleting.value = true
  deleteError.value = ''
  try {
    await api.deleteReaffiliation(reaff?._id)
    if (isPostHogConfigured) posthog.capture('reaffiliation_deleted')
    deleteTarget.value = null
    await load()
  } catch (e) {
    deleteError.value = e?.detail || "Failed to delete reaffiliation."
  } finally {
    deleting.value = false
  }
}

async function deleteReaff(record) {
  if (!window.confirm('Delete this reaffiliation record? This cannot be undone.')) return
  try {
    await api.deleteReaffiliation(fetchId(record))
    await load()
  } catch (e) {
    error.value = e?.detail || 'Failed to delete reaffiliation.'
  }
}

const fetchId = (m) => m?.id ?? m?._id

const lNFnName = (m) => `${m?.last_name}, ${m?.first_name} ${m?.middle_name} ${m?.suffix}`

const columns = [
  { key: 'name', label: 'Name', format: (_v, m) => lNFnName(m?.member) },
  { key: 'dssoc_id', label: 'DSSOC ID', cellClass: 'figure' },
  {
    key: 'designation',
    label: 'Designation',
    cellClass: (m) => ['figure', `desig-${m?.designation?.toLowerCase()}`],
  },
  { key: 'member.student_number', label: 'Student Number', cellClass: 'figure' },
  { key: 'member.up_mail', label: 'UP Mail' },
]

const menuItems = computed(() => [
  {
    key: 'view',
    label: 'View',
    icon: 'visibility',
    show: canRead.value,
    onClick: (m) => (viewRecord.value = m),
  },
  {
    key: 'edit',
    label: 'Edit',
    icon: 'more_horiz',
    show: canEditMember.value || canEditReaff.value,
    children: [
      // TODO: open the edit-member modal once it exists.
      { key: 'edit-member', label: 'Edit Member', show: canEditMember.value },
      // TODO: open the edit-reaffiliation modal once it exists.
      { key: 'edit-reaff', label: 'Edit Reaffiliation', show: canEditReaff.value },
    ],
  },
  {
    key: 'delete',
    label: 'Delete',
    icon: 'delete',
    danger: true,
    show: canDelete.value,
    ariaLabel: (m) => `Delete Reaffiliation?`,
    onClick: askDeleteReaff,
  },
])

// Filters the loaded page. Server-side name search is not exposed yet.
const rows = computed(() => {
  const list = result?.value?.data ?? []
  const q = search.value.trim().toLowerCase()
  if (!q) return list
  return list.filter((r) =>
    [r?.member.student_number, r?.member.up_mail, r?.member._id]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q))
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
      <h1>Reaffiliations</h1>
      <p class="muted sub">Members who reaffiliated in the selected semester.</p>
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
        <input id="q" v-model="search" type="search" placeholder="Name, student number, email" />
      </div>
    </div>
  </header>

  <p v-if="error" class="notice" role="alert">{{ error }}</p>
  <p v-else-if="loading" class="muted">Loading {{ selected }}…</p>

  <template v-else-if="result">
    <p class="count">
      <span class="figure">{{ result.total }}</span> members reaffiliated in {{ selected }}<span
        v-if="result.total"
      >
        · showing {{ firstOnPage }}–{{ lastOnPage }}</span
      >
    </p>

    <DataTable
      :columns="columns"
      :rows="rows"
      row-key="dssoc_id"
      :show-actions="hasAnyAction"
      compact-actions
      :empty-text="
        search
          ? 'No one on this page matches that search. Try another page or clear the search.'
          : 'No reaffiliations recorded for this semester yet.'
      "
    >
      <template #actions="{ row }">
        <RowActionMenu
          :items="menuItems"
          :row="row"
          :aria-label="`Actions for ${lNFnName(row.member)}`"
        />
      </template>
    </DataTable>

    <TablePager v-model:page="page" :total-pages="result.total_pages" />
  </template>

  <SingleReaffiliation
    v-if="viewRecord"
    :record="viewRecord"
    @close="viewRecord = null"
  />

  <DeleteModal
    v-if="deleteTarget"
    title="Delete Reaffiliation"
    confirm-label="Delete reaffiliation"
    :busy="deleting"
    :error="deleteError"
    @close="cancelDelete"
    @confirm="confirmDelete"
  >
    Delete reaffiliation? This instance will no longer appear and be counted in the public dashboard.
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

/* Designation chips live on cells DataTable renders, so they need :deep(). */
:deep(.desig-associate) {
  background-color: #af83c8;
  color: #fff !important;
}

:deep(.desig-fellow) {
  background-color: #9729d5;
  color: #fff !important;
}
</style>
