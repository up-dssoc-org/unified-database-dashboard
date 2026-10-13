<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import AddEditModal from '@/components/generic/AddEditModal.vue'

const props = defineProps({
  record: { type: Object, required: true },
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

const statusOptionsFor = (designation) =>
  designation?.toLowerCase() === 'associate'
    ? [...BASE_STATUSES, ...ASSOCIATE_STATUSES]
    : BASE_STATUSES

const loading = ref(true)
const error = ref('')
const history = ref([])

// Status history per reaffiliation id, fetched the first time its row is opened.
const expanded = reactive(new Set())
const statusHistory = reactive({})

const rowKey = (h, i) => h._id ?? i

// `quiet` refreshes after a write without blanking the timeline into a
// loading state; a failed quiet refresh keeps the entries already shown.
async function loadStatusHistory(reaffId, { quiet = false } = {}) {
  if (!quiet || !statusHistory[reaffId]) {
    statusHistory[reaffId] = { loading: true, error: '', items: [] }
  }
  try {
    const res = await api.getSingleReaffiliationHistory(reaffId)
    // The API returns entries most recent first; keep that order.
    statusHistory[reaffId].items = Array.isArray(res) ? res : (res?.history ?? [])
    statusHistory[reaffId].error = ''
  } catch (e) {
    if (!quiet) statusHistory[reaffId].error = e.detail || 'Failed to load reaffiliation history.'
  } finally {
    statusHistory[reaffId].loading = false
  }
}

// Add/edit modal. `entry` is null when adding.
const historyModal = ref(null)
const modalBusy = ref(false)
const modalError = ref('')

const modalFields = computed(() => [
  {
    key: 'reaffStatus',
    label: 'Reaffiliation Status',
    type: 'select',
    required: true,
    options: statusOptionsFor(historyModal.value?.designation),
  },
  {
    key: 'remarks',
    label: 'Remarks',
    placeholder: 'Optional notes about this status change',
  },
])

const modalValues = computed(() => {
  const entry = historyModal.value?.entry
  return entry ? { reaffStatus: statusOf(entry), remarks: entry.remarks ?? null } : null
})

const modalDescription = computed(() => {
  const h = historyModal.value?.reaff
  return h ? `${h.year}${h.semester} · ${h.designation ?? 'No designation'}` : ''
})

function openAddModal(h) {
  modalError.value = ''
  historyModal.value = { reaff: h, designation: h.designation, entry: null }
}

function openEditModal(h, entry) {
  modalError.value = ''
  historyModal.value = { reaff: h, designation: h.designation, entry }
}

function closeModal() {
  if (!modalBusy.value) historyModal.value = null
}

async function submitHistory(payload) {
  const { reaff, entry } = historyModal.value
  modalBusy.value = true
  modalError.value = ''
  try {
    if (entry) {
      await api.updateSingleReaffiliationHistory(reaff._id, entry._id, payload)
    } else {
      await api.addSingleReaffiliationHistory(reaff._id, payload)
    }
    historyModal.value = null
    await loadStatusHistory(reaff._id, { quiet: true })
  } catch (e) {
    modalError.value = e.detail || 'Failed to save the history entry.'
  } finally {
    modalBusy.value = false
  }
}

// Delete is two-step: the first click arms the node (the icon turns into a
// check), the second deletes. Leaving the node disarms it.
const confirmingDelete = ref(null)
const deleting = ref(null)
const deleteError = reactive({})

async function onDeleteClick(reaffId, entry) {
  if (confirmingDelete.value !== entry._id) {
    confirmingDelete.value = entry._id
    delete deleteError[entry._id]
    return
  }
  deleting.value = entry._id
  try {
    await api.deleteSingleReaffiliationHistory(reaffId, entry._id)
    const list = statusHistory[reaffId].items
    statusHistory[reaffId].items = list.filter((e) => e._id !== entry._id)
  } catch (e) {
    deleteError[entry._id] = e.detail || 'Failed to delete this entry.'
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

function toggleRow(reaffId) {
  if (expanded.has(reaffId)) {
    expanded.delete(reaffId)
    return
  }
  expanded.add(reaffId)
  const entry = statusHistory[reaffId]
  if (!entry || entry.error) loadStatusHistory(reaffId)
}

const statusOf = (entry) => entry.status ?? entry.reaffStatus ?? '—'

const formatTimestamp = (entry) => {
  const ts = entry.metadata?.updated_at ?? entry.metadata?.created_at
  if (!ts) return '—'
  const d = new Date(ts)
  return Number.isNaN(d.getTime())
    ? ts
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const member = props.record.member

const PROFILE_FIELDS = [
  { key: 'student_number', label: 'Student Number' },
  { key: 'pronouns',       label: 'Pronouns' },
  { key: 'birthday',       label: 'Birthday' },
  { key: 'contact_number', label: 'Contact Number' },
  { key: 'personal_email', label: 'Personal Email' },
  { key: 'up_mail',        label: 'UP Mail' },
]

const fullName = (m) =>
  [m?.first_name, m?.middle_name, m?.last_name, m?.suffix].filter(Boolean).join(' ')

const formatValue = (val) => (val == null || val === '' ? '—' : val)

onMounted(async () => {
  try {
    const res = await api.getSingleMemberHistory({ dssoc_id: props.record.dssoc_id })
    const list = Array.isArray(res) ? res : (res?.data ?? [])
    history.value = [...list].sort((a, b) => {
      if (a.year !== b.year) return Number(a.year) - Number(b.year)
      return String(a.semester).localeCompare(String(b.semester))
    })
  } catch (e) {
    error.value = e.detail || 'Failed to load affiliation history.'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')">
      <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="reaff-modal-title">

        <div class="modal-header">
          <div>
            <h3 id="reaff-modal-title">{{ fullName(member) }}</h3>
            <span class="dssoc-id figure">{{ record.dssoc_id }}</span>
          </div>
          <button class="close-btn" aria-label="Close" @click="emit('close')">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <div class="modal-body">
          <!-- Member Profile -->
          <section class="section">
            <h4 class="section-title">Member Profile</h4>
            <dl class="fields">
              <div v-for="f in PROFILE_FIELDS" :key="f.key" class="field-row">
                <dt>{{ f.label }}</dt>
                <dd>{{ formatValue(member?.[f.key]) }}</dd>
              </div>
            </dl>
          </section>

          <!-- Affiliation History -->
          <section class="section">
            <h4 class="section-title">
              Affiliation History
              <span v-if="!loading && !error" class="count-badge">{{ history.length }}</span>
            </h4>

            <p v-if="loading" class="muted small">Loading history…</p>
            <p v-else-if="error" class="notice small">{{ error }}</p>
            <template v-else-if="history.length">
              <table class="history-table">
                <thead>
                  <tr>
                    <th class="toggle-col"><span class="visually-hidden">History</span></th>
                    <th>Semester</th>
                    <th>Designation</th>
                  </tr>
                </thead>
                <tbody>
                  <template v-for="(h, i) in history" :key="rowKey(h, i)">
                    <tr>
                      <td class="toggle-col">
                        <button
                          v-if="h._id"
                          class="row-toggle"
                          :class="{ open: expanded.has(h._id) }"
                          :aria-expanded="expanded.has(h._id)"
                          :aria-controls="`reaff-history-${h._id}`"
                          :aria-label="`${expanded.has(h._id) ? 'Hide' : 'Show'} history for ${h.year}${h.semester}`"
                          @click="toggleRow(h._id)"
                        >
                          <span class="material-symbols-outlined">expand_more</span>
                        </button>
                      </td>
                      <td class="figure">{{ h.year }}{{ h.semester }}</td>
                      <td
                        class="figure desig"
                        :class="`desig-${h.designation?.toLowerCase()}`"
                      >{{ h.designation }}</td>
                    </tr>

                    <tr
                      v-if="h._id && expanded.has(h._id)"
                      :id="`reaff-history-${h._id}`"
                      class="history-detail"
                    >
                      <td colspan="3">
                        <p v-if="statusHistory[h._id]?.loading" class="muted small">Loading history…</p>
                        <p v-else-if="statusHistory[h._id]?.error" class="notice small">
                          {{ statusHistory[h._id].error }}
                        </p>
                        <template v-else-if="statusHistory[h._id]?.items.length">
                          <div v-if="canAddHistory" class="timeline-add">
                            <button class="add-btn" @click="openAddModal(h)">
                              <span class="material-symbols-outlined">add</span>
                              Add entry
                            </button>
                          </div>
                          <ol class="timeline">
                            <li
                              v-for="(entry, j) in statusHistory[h._id].items"
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
                                    @click="openEditModal(h, entry)"
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
                                    @click="onDeleteClick(h._id, entry)"
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
                            <button class="link-btn" @click="openAddModal(h)">
                              Add a history entry
                            </button>
                            to start tracking this reaffiliation's status.
                          </p>
                        </div>
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </template>
            <p v-else class="muted small">No affiliation history found.</p>
          </section>
        </div>

      </div>
    </div>

    <!-- Teleports to body after the panel above, so it stacks on top of it. -->
    <AddEditModal
      v-if="historyModal"
      :title="historyModal.entry ? 'Edit history entry' : 'Add history entry'"
      :description="modalDescription"
      :fields="modalFields"
      :values="modalValues"
      :busy="modalBusy"
      :error="modalError"
      @close="closeModal"
      @submit="submitHistory"
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

.dssoc-id {
  font-size: 0.78rem;
  color: var(--slate);
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

/* Section */
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

/* Profile fields */
.fields {
  margin: 0;
  display: flex;
  flex-direction: column;
}

.field-row {
  display: grid;
  grid-template-columns: 10rem 1fr;
  gap: 0.5rem;
  padding: 0.45rem 0;
  border-bottom: 1px solid var(--rule);
  align-items: baseline;
}

.field-row:last-child {
  border-bottom: none;
}

dt {
  font-size: 0.8rem;
  color: var(--slate);
}

dd {
  margin: 0;
  font-size: 0.88rem;
  word-break: break-word;
}

/* History table */
.history-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}

.history-table th {
  text-align: left;
  font-weight: 500;
  font-size: 0.75rem;
  color: var(--slate);
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--rule);
}

.history-table td {
  padding: 0.45rem 0.75rem;
  border-bottom: 1px solid #eef0ec;
}

.history-table tbody tr:last-child td {
  border-bottom: none;
}

.desig {
  font-size: 0.8rem;
}

.desig-associate {
  background-color: #af83c8;
  color: #fff !important;
}

.desig-fellow {
  background-color: #9729d5;
  color: #fff !important;
}

.small {
  font-size: 0.85rem;
  margin: 0;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* Row toggle */
.history-table .toggle-col {
  width: 2rem;
  padding-right: 0;
}

.row-toggle {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.1rem;
  border-radius: 4px;
  color: var(--slate);
  display: flex;
  align-items: center;
  line-height: 1;
  transition: background 0.12s, color 0.12s;
}

.row-toggle:hover {
  background: var(--rule);
  color: var(--ink);
}

.row-toggle .material-symbols-outlined {
  font-size: 1.15rem;
  transition: transform 0.15s;
}

.row-toggle.open .material-symbols-outlined {
  transform: rotate(180deg);
}

.history-table .history-detail td {
  background: var(--canvas);
  padding: 0.75rem 1rem;
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
