<script setup>
import { computed, onMounted, ref } from 'vue'
import { api } from '@/api/client'
import DataTable from '@/components/table/DataTable.vue'
import { toast } from '@/components/generic/useToast'
import { useAuthStore } from '@/stores/auth'

const result = ref(null)
const loading = ref(true)
const error = ref('')
const search = ref('')

const auth = useAuthStore()

const canRead = computed(() => auth.can('read:all'))
const canCreate = computed(() => auth.can('create:all'))
const canEdit = computed(() => auth.can('update:all'))
const canDelete = computed(() => auth.can('delete:all'))
const hasAnyAction = computed(() => canEdit.value || canDelete.value)

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
    result.value = await api.getCommittees()
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

// TODO: call the delete endpoint once the API exposes one for top-level committees.
async function deleteCommittee(committee) {
  if (!window.confirm(`Delete ${committee.name} (${committee._id})? This cannot be undone.`)) return
}

const categoryNum = (c) => String(c?.category_num ?? '').padStart(2, '0')

const columns = [
  { key: 'category_num', label: 'Category', cellClass: 'figure', format: (_v, c) => categoryNum(c) },
  { key: '_id', label: 'Initials', cellClass: 'figure' },
  { key: 'name', label: 'Name' },
]

const rowActions = computed(() => [
  {
    key: 'edit',
    label: 'Edit',
    icon: 'edit',
    show: canEdit.value,
    ariaLabel: (c) => `Edit ${c.name}`,
    onClick: editCommittee,
  },
  {
    key: 'delete',
    label: 'Delete',
    icon: 'delete',
    danger: true,
    show: canDelete.value,
    ariaLabel: (c) => `Delete ${c.name}`,
    onClick: deleteCommittee,
  },
])

const rows = computed(() => {
  const list = (result.value?.data ?? [])
    .filter((c) => !c.is_deleted)
    .sort((a, b) => categoryNum(a).localeCompare(categoryNum(b)) || a._id.localeCompare(b._id))
  const q = search.value.trim().toLowerCase()
  if (!q) return list
  return list.filter((c) =>
    [c._id, c.name, c.category_num].some((v) => String(v ?? '').toLowerCase().includes(q))
  )
})
</script>

<template>
  <header class="head">
    <div>
      <h1>Committees</h1>
      <p class="muted sub">Committees members can be assigned to.</p>
    </div>
    <div class="controls">
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
      <span class="figure">{{ rows.length }}</span> committees<span v-if="search"> match</span>
    </p>

    <DataTable
      :columns="columns"
      :rows="rows"
      row-key="_id"
      :actions="rowActions"
      :show-actions="hasAnyAction"
      :empty-text="search ? 'No committee matches that search.' : 'No committees recorded yet.'"
    />
  </template>

  <!-- DELETE MODAL SHOULD BE HERE -->
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
</style>
