<script setup>
/**
 * The status history of one reaffiliation, as a timeline that can be added
 * to, edited and pruned in place.
 *
 * Unlike SingleReaffiliation, which lists every semester of a member and
 * expands each on demand, this opens straight onto the one record passed in.
 */
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { toast } from '@/components/generic/useToast'
import AddEditModal from '@/components/generic/AddEditModal.vue'

const props = defineProps({
  /** The reaffiliation whose history is shown; needs `_id`, `year`, `semester`. */
  reaff: { type: Object, required: true },
})

const emit = defineEmits(['close'])

const auth = useAuthStore()
// Editors and admins may add and edit entries; only admins may delete them.
// Add mirrors the backend permissions on PUT /reaffiliations/history/{reaff_id}.
const canAddHistory = computed(() => auth.can('create:all', 'create:reaff'))
const canEditHistory = canAddHistory
const canDeleteHistory = computed(() => auth.can('delete:all'))

const BASE_STATUSES = ['Active', 'Inactive', 'Probationary', 'Expulsion', 'Expired']
const ASSOCIATE_STATUSES = ['Deferred', 'Rejected']

const statusOptions = computed(() =>
  props.reaff.designation?.toLowerCase() === 'associate'
    ? [...BASE_STATUSES, ...ASSOCIATE_STATUSES]
    : BASE_STATUSES
)

const loading = ref(true)
const error = ref('')
const items = ref([])

// `quiet` refreshes after a write without blanking the timeline into a
// loading state; a failed quiet refresh keeps the entries already shown.
async function load({ quiet = false } = {}) {
  if (!quiet) {
    loading.value = true
    error.value = ''
  }
  try {
    const res = await api.getSingleReaffiliationHistory(props.reaff._id)
    // The API returns entries most recent first; keep that order.
    items.value = Array.isArray(res) ? res : (res?.history ?? [])
    error.value = ''
  } catch (e) {
    if (!quiet) error.value = e?.detail || 'Failed to load reaffiliation history.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

// Add/edit modal. `entry` is null when adding.
const entryModal = ref(null)
const modalBusy = ref(false)
const modalError = ref('')

const modalFields = computed(() => [
  {
    key: 'reaffStatus',
    label: 'Reaffiliation Status',
    type: 'select',
    required: true,
    options: statusOptions.value,
  },
  {
    key: 'remarks',
    label: 'Remarks',
    placeholder: 'Optional notes about this status change',
  },
])

const modalValues = computed(() => {
  const entry = entryModal.value?.entry
  return entry ? { reaffStatus: statusOf(entry), remarks: entry.remarks ?? null } : null
})

function openAddModal() {
  modalError.value = ''
  entryModal.value = { entry: null }
}

function openEditModal(entry) {
  modalError.value = ''
  entryModal.value = { entry }
}

function closeModal() {
  if (!modalBusy.value) entryModal.value = null
}

async function submitEntry(payload) {
  const { entry } = entryModal.value
  modalBusy.value = true
  modalError.value = ''
  try {
    if (entry) {
      await api.updateSingleReaffiliationHistory(props.reaff._id, entry._id, payload)
    } else {
      await api.addSingleReaffiliationHistory(props.reaff._id, payload)
    }
    entryModal.value = null
    toast.success(entry ? 'History entry updated!' : 'History entry added!')
    await load({ quiet: true })
  } catch (e) {
    // Kept in the modal so the edits survive and can be retried.
    modalError.value = e?.detail || 'Failed to save the history entry.'
  } finally {
    modalBusy.value = false
  }
}

// Delete is two-step: the first click arms the node (the icon turns into a
// check), the second deletes. Leaving the node disarms it.
const confirmingDelete = ref(null)
const deleting = ref(null)
const deleteError = reactive({})

async function onDeleteClick(entry) {
  if (confirmingDelete.value !== entry._id) {
    confirmingDelete.value = entry._id
    delete deleteError[entry._id]
    return
  }
  deleting.value = entry._id
  try {
    await api.deleteSingleReaffiliationHistory(props.reaff._id, entry._id)
    items.value = items.value.filter((e) => e._id !== entry._id)
    toast.warning('History entry deleted!')
  } catch (e) {
    deleteError[entry._id] = e?.detail || 'Failed to delete this entry.'
  } finally {
    deleting.value = null
    confirmingDelete.value = null
  }
}

function disarmDelete(entry) {
  if (confirmingDelete.value === entry._id && deleting.value !== entry._id) {
    confirmingDelete.value = null
  }
}

// The entry modal stacked on top handles its own Escape; this one only
// closes when nothing sits above it.
function onKeydown(event) {
  if (event.key === 'Escape' && !entryModal.value) emit('close')
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))

const statusOf = (entry) => entry.status ?? entry.reaffStatus ?? '—'

const formatTimestamp = (entry) => {
  const ts = entry.metadata?.updated_at ?? entry.metadata?.created_at
  if (!ts) return '—'
  const d = new Date(ts)
  return Number.isNaN(d.getTime())
    ? ts
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const semester = computed(() =>
  props.reaff.year ? `${props.reaff.year}${props.reaff.semester ?? ''}` : ''
)

const entryModalDescription = computed(() =>
  `${props.reaff.dssoc_id} · ${semester.value} · ${props.reaff.designation ?? 'No designation'}`
)
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')">
      <div
        class="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reaff-history-modal-title"
      >

        <div class="modal-header">
          <div>
            <h3 id="reaff-history-modal-title">Reaffiliation history</h3>
            <span class="sub figure">
              {{ reaff.dssoc_id }} · {{ semester }}
              <span
                v-if="reaff.designation"
                class="desig"
                :class="`desig-${reaff.designation.toLowerCase()}`"
              >{{ reaff.designation }}</span>
            </span>
          </div>
          <button class="close-btn" aria-label="Close" @click="emit('close')">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <div class="modal-body">
          <section class="section">
            <h4 class="section-title">
              Status History
              <span v-if="!loading && !error" class="count-badge">{{ items.length }}</span>
            </h4>

            <p v-if="loading" class="muted small">Loading history…</p>
            <p v-else-if="error" class="notice small" role="alert">{{ error }}</p>
            <template v-else-if="items.length">
              <div v-if="canAddHistory" class="timeline-add">
                <button class="add-btn" @click="openAddModal">
                  <span class="material-symbols-outlined">add</span>
                  Add entry
                </button>
              </div>
              <ol class="timeline">
                <li
                  v-for="(entry, j) in items"
                  :key="entry._id ?? j"
                  class="timeline-node"
                  :class="[
                    `status-${statusOf(entry).toLowerCase()}`,
                    { armed: confirmingDelete === entry._id },
                  ]"
                  @mouseleave="disarmDelete(entry)"
                >
                  <div class="node-body">
                    <div class="node-content">
                      <div class="node-head">
                        <span class="node-status">{{ statusOf(entry) }}</span>
                        <span v-if="j === 0" class="node-latest">Latest</span>
                      </div>
                      <time class="node-time figure">{{ formatTimestamp(entry) }}</time>
                      <p v-if="entry.remarks" class="node-remarks">{{ entry.remarks }}</p>
                      <p v-if="deleteError[entry._id]" class="node-error">
                        {{ deleteError[entry._id] }}
                      </p>
                    </div>

                    <div
                      v-if="entry._id != null && (canEditHistory || canDeleteHistory)"
                      class="node-actions"
                    >
                      <button
                        v-if="canEditHistory"
                        class="icon-btn"
                        :aria-label="`Edit ${statusOf(entry)} entry`"
                        title="Edit"
                        :disabled="deleting === entry._id"
                        @click="openEditModal(entry)"
                      >
                        <span class="material-symbols-outlined">edit</span>
                      </button>
                      <button
                        v-if="canDeleteHistory"
                        class="icon-btn danger"
                        :class="{ confirm: confirmingDelete === entry._id }"
                        :aria-label="confirmingDelete === entry._id
                          ? `Confirm deleting ${statusOf(entry)} entry`
                          : `Delete ${statusOf(entry)} entry`"
                        :title="confirmingDelete === entry._id ? 'Click to confirm' : 'Delete'"
                        :disabled="deleting === entry._id"
                        @click="onDeleteClick(entry)"
                      >
                        <span class="material-symbols-outlined">
                          {{ confirmingDelete === entry._id ? 'check' : 'delete' }}
                        </span>
                      </button>
                    </div>
                  </div>
                </li>
              </ol>
            </template>
            <div v-else class="history-empty">
              <p class="muted small">This reaffiliation has no associated history with it.</p>
              <p v-if="canAddHistory" class="small add-prompt">
                <button class="link-btn" @click="openAddModal">Add a history entry</button>
                to start tracking this reaffiliation's status.
              </p>
            </div>
          </section>
        </div>

      </div>
    </div>

    <!-- Teleports to body after the panel above, so it stacks on top of it. -->
    <AddEditModal
      v-if="entryModal"
      :title="entryModal.entry ? 'Edit history entry' : 'Add history entry'"
      :description="entryModalDescription"
      :fields="modalFields"
      :values="modalValues"
      :busy="modalBusy"
      :error="modalError"
      @close="closeModal"
      @submit="submitEntry"
    />
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(22, 25, 26, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 500;
  padding: 1rem;
}

.modal-panel {
  background: var(--surface);
  border-radius: 0.5rem;
  border: 1px solid var(--rule);
  box-shadow: 0 8px 32px rgba(22, 25, 26, 0.18);
  width: 100%;
  max-width: 520px;
  max-height: 90vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

/* Header */
.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.25rem 1.5rem 1rem;
  border-bottom: 1px solid var(--rule);
  position: sticky;
  top: 0;
  background: var(--surface);
  z-index: 1;
}

.modal-header h3 {
  margin: 0 0 0.2rem;
  font-size: 1rem;
}

.sub {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.78rem;
  color: var(--slate);
}

.desig {
  font-size: 0.72rem;
  padding: 0.05rem 0.45rem;
  border-radius: 2px;
}

.desig-associate {
  background-color: #af83c8;
  color: #fff;
}

.desig-fellow {
  background-color: #9729d5;
  color: #fff;
}

.close-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.15rem;
  border-radius: 4px;
  color: var(--slate);
  display: flex;
  align-items: center;
  line-height: 1;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s;
}

.close-btn:hover {
  background: var(--rule);
  color: var(--ink);
}

.close-btn .material-symbols-outlined {
  font-size: 1.2rem;
}

/* Body */
.modal-body {
  padding: 0 1.5rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.section {
  padding-top: 1.25rem;
}

.section-title {
  margin: 0 0 0.75rem;
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--slate);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--rule);
  color: var(--ink);
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  letter-spacing: 0;
  text-transform: none;
}

.small {
  font-size: 0.85rem;
  margin: 0;
}

/* Status timeline: a vertical node path, most recent at the top */
.timeline {
  list-style: none;
  margin: 0;
  padding: 0;
}

.timeline-node {
  --node-color: var(--slate);
  position: relative;
  padding: 0 0 0.85rem 1.4rem;
}

.timeline-node:last-child {
  padding-bottom: 0;
}

/* Connector to the next (older) node */
.timeline-node:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 0.3rem;
  top: 0.85rem;
  bottom: -0.1rem;
  width: 2px;
  background: var(--rule);
}

.timeline-node::after {
  content: '';
  position: absolute;
  left: 0;
  top: 0.3rem;
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 50%;
  background: var(--surface);
  border: 2px solid var(--node-color);
  box-sizing: border-box;
}

.timeline-node:first-child::after {
  background: var(--node-color);
}

.status-active        { --node-color: var(--forest); }
.status-probationary,
.status-deferred      { --node-color: var(--ochre); }
.status-expulsion,
.status-rejected      { --node-color: var(--maroon); }

.node-body {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}

.node-content {
  flex: 1;
  min-width: 0;
}

/* Row-end actions: revealed on hover/focus, or while a delete is armed */
.node-actions {
  display: flex;
  gap: 0.15rem;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.12s;
}

.timeline-node:hover .node-actions,
.timeline-node:focus-within .node-actions,
.timeline-node.armed .node-actions {
  opacity: 1;
}

/* No hover on touch screens, so the actions stay visible there. */
@media (hover: none) {
  .node-actions {
    opacity: 1;
  }
}

.icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.15rem;
  border-radius: 4px;
  color: var(--slate);
  display: flex;
  align-items: center;
  line-height: 1;
  transition: background 0.12s, color 0.12s;
}

.icon-btn:hover:not(:disabled) {
  background: var(--rule);
  color: var(--ink);
}

.icon-btn.danger:hover:not(:disabled) {
  color: var(--maroon);
}

.icon-btn.confirm {
  background: var(--maroon);
  color: #fff;
}

.icon-btn.confirm:hover:not(:disabled) {
  background: var(--maroon-deep);
  color: #fff;
}

.icon-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.icon-btn .material-symbols-outlined {
  font-size: 1rem;
}

.node-error {
  margin: 0.2rem 0 0;
  font-size: 0.75rem;
  color: #c0392b;
}

/* Centered add button above the timeline */
.timeline-add {
  display: flex;
  justify-content: center;
  margin-bottom: 0.75rem;
}

.add-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  background: var(--surface);
  border: 1px dashed var(--slate);
  border-radius: 999px;
  padding: 0.2rem 0.75rem 0.2rem 0.5rem;
  font: inherit;
  font-size: 0.78rem;
  color: var(--slate);
  cursor: pointer;
  transition: border-color 0.12s, color 0.12s;
}

.add-btn:hover {
  border-color: var(--maroon);
  color: var(--maroon);
}

.add-btn .material-symbols-outlined {
  font-size: 1rem;
}

.node-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.node-status {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--node-color);
}

.node-latest {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--slate);
  border: 1px solid var(--rule);
  border-radius: 999px;
  padding: 0 0.4rem;
}

.node-time {
  display: block;
  font-size: 0.74rem;
  color: var(--slate);
}

.node-remarks {
  margin: 0.15rem 0 0;
  font-size: 0.75rem;
  color: var(--slate);
  word-break: break-word;
}

/* Empty state */
.history-empty {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.add-prompt {
  color: var(--slate);
}

.link-btn {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: var(--steel);
  text-decoration: underline;
  cursor: pointer;
}

.link-btn:hover {
  color: var(--ink);
}
</style>
