<script setup>
/**
 * Dialog for merging two member records into one.
 *
 * The editor picks the member to keep and the member to merge away, each
 * through an OptionPickerModal over the full member list (filterable by
 * semester and searchable by name or student number). Once both are chosen the
 * dialog lays the two records side by side and shows what the merged record
 * will hold:
 *
 *   - a field only the removed member has is copied onto the kept one;
 *   - a field both have, with different values, is a conflict — the kept
 *     member's value wins unless the editor picks the other one;
 *   - everything else stays as the kept member has it.
 *
 * "Merge users" opens a confirmation first; only confirming emits `submit`
 * with the `{ surviving_id, nonsurviving_id, merge }` body for
 * `api.mergeMembers`. Like the other modals the caller owns the request: it
 * drives `busy` and `error` while it runs and closes the dialog by dropping
 * the `v-if` once it succeeds.
 */
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, useId, watch } from 'vue'
import { api } from '@/api/client'
import OptionPickerModal from '@/components/generic/OptionPickerModal.vue'
import DeleteModal from '@/components/generic/DeleteModal.vue'
import { useDebounced } from '@/components/generic/useDebounced'

const props = defineProps({
  /** Starts as the member to keep — usually the row the merge was opened from. */
  member: { type: Object, default: null },
  /** `[{ year, semester }]`, for the picker's semester filter. */
  semesters: { type: Array, default: () => [] },
  /** Disables the dialog and shows progress while the caller's merge runs. */
  busy: { type: Boolean, default: false },
  /** Message from a failed merge, shown in the confirmation. */
  error: { type: String, default: '' },
})

const emit = defineEmits(['close', 'submit'])

const uid = useId()
const panel = ref(null)

/** The fields the merge endpoint can write onto the kept member. */
const FIELDS = [
  { key: 'last_name', label: 'Last name' },
  { key: 'first_name', label: 'First name' },
  { key: 'middle_name', label: 'Middle name' },
  { key: 'suffix', label: 'Suffix' },
  { key: 'pronouns', label: 'Pronouns' },
  { key: 'student_number', label: 'Student number' },
  { key: 'birthday', label: 'Birthday' },
  { key: 'contact_number', label: 'Contact number' },
  { key: 'personal_email', label: 'Personal email' },
  { key: 'up_mail', label: 'UP Mail' },
]

const surviving = ref(props.member)
const removed = ref(null)

const fullName = (m) =>
  [m?.first_name, m?.middle_name, m?.last_name, m?.suffix].filter(Boolean).join(' ') || m?._id

const memberText = (m) => (m ? `${fullName(m)} · ${m._id}` : '')

// ── Picker ──

/** Which slot the picker is filling: 'surviving', 'removed', or null. */
const picking = ref(null)
const pickSemester = ref('')
const pickSearch = ref('')
const pickQuery = useDebounced(() => pickSearch.value.trim())
// The search the shown page was fetched with, so a settled query that a
// semester or page change has already fetched does not fetch again.
const pickSearchLoaded = ref('')
const pickPage = ref(1)
const pickResult = ref(null)
const pickLoading = ref(false)
const pickError = ref('')

const pickColumns = [
  { key: '_id', label: 'DSSOC ID', cellClass: 'figure' },
  { key: 'student_number', label: 'Student Number', cellClass: 'figure' },
  { key: 'last_name', label: 'Last Name' },
  { key: 'first_name', label: 'First Name' },
  { key: 'middle_name', label: 'Middle Name' },
]

// Typing or paging quickly can leave an older request in flight; only the
// latest one is allowed to land.
let pickRequest = 0

async function loadOptions() {
  const ticket = ++pickRequest
  pickLoading.value = true
  pickError.value = ''
  pickSearchLoaded.value = pickSearch.value.trim()
  try {
    const res = await api.getMembers({
      year: pickSemester.value.slice(0, 4) || null,
      sem: pickSemester.value.slice(4) || null,
      search: pickSearchLoaded.value || null,
      page: pickPage.value,
    })
    if (ticket === pickRequest) pickResult.value = res
  } catch (e) {
    if (ticket !== pickRequest) return
    pickResult.value = null
    pickError.value = e?.detail || 'Could not load members.'
  } finally {
    if (ticket === pickRequest) pickLoading.value = false
  }
}

function openPicker(slot) {
  picking.value = slot
  pickSearch.value = ''
  pickPage.value = 1
  loadOptions()
}

function changePickFilter() {
  pickPage.value = 1
  loadOptions()
}

// Only while the picker is open: the box is cleared on the way in, and that
// reset settles after the opening fetch has already used it.
watch(pickQuery, (query) => {
  if (picking.value && query !== pickSearchLoaded.value) changePickFilter()
})

function changePickPage(next) {
  pickPage.value = next
  loadOptions()
}

// The member already in the other slot is left out, so the same record cannot
// be merged into itself.
const otherSlotId = computed(() =>
  (picking.value === 'surviving' ? removed.value : surviving.value)?._id
)
const pickRows = computed(() =>
  (pickResult.value?.data ?? []).filter((m) => m._id !== otherSlotId.value)
)

function pick(member) {
  if (picking.value === 'surviving') surviving.value = member
  else removed.value = member
  picking.value = null
}

function swap() {
  ;[surviving.value, removed.value] = [removed.value, surviving.value]
}

// ── Comparison ──

const blank = (v) => v === null || v === undefined || String(v).trim() === ''
const same = (a, b) => String(a).trim() === String(b).trim()

/** Conflicting field key → 'surviving' | 'removed'; unset means the kept value. */
const choices = reactive({})

watch([surviving, removed], () => {
  for (const key of Object.keys(choices)) delete choices[key]
})

const ready = computed(() => Boolean(surviving.value && removed.value))

const comparison = computed(() => {
  if (!ready.value) return []
  return FIELDS.map((field) => {
    const keep = surviving.value[field.key]
    const other = removed.value[field.key]
    let status
    if (blank(keep) && blank(other)) status = 'empty'
    else if (blank(other)) status = 'kept'
    else if (blank(keep)) status = 'filled'
    else if (same(keep, other)) status = 'same'
    else status = 'conflict'
    const from =
      status === 'filled' || (status === 'conflict' && choices[field.key] === 'removed')
        ? 'removed'
        : 'surviving'
    return { ...field, keep, other, status, from, result: from === 'removed' ? other : keep }
  }).filter((row) => row.status !== 'empty')
})

/** The rows whose merged value comes from the removed member. */
const mergedIn = computed(() => comparison.value.filter((row) => row.from === 'removed'))
const conflictCount = computed(() => comparison.value.filter((row) => row.status === 'conflict').length)

const STATUS_TEXT = {
  same: 'Same',
  kept: 'Kept',
  filled: 'Merged in',
  conflict: 'Differs',
}

// ── Confirmation ──

const confirming = ref(false)
// A failed merge's message belongs to that attempt; reopening the
// confirmation starts clean.
const confirmError = ref('')
watch(() => props.error, (message) => { confirmError.value = message })

function askConfirm() {
  if (!ready.value || props.busy) return
  confirmError.value = ''
  confirming.value = true
}

function confirmMerge() {
  emit('submit', {
    surviving_id: surviving.value._id,
    nonsurviving_id: removed.value._id,
    merge: Object.fromEntries(mergedIn.value.map((row) => [row.key, row.other])),
  })
}

// ── Dialog ──

function close() {
  if (!props.busy) emit('close')
}

// The picker catches its own Escape before it gets here; the confirmation
// handles its own, so this one stands down while that is open.
function onKeydown(event) {
  if (event.key === 'Escape' && !confirming.value) close()
}

onMounted(async () => {
  document.addEventListener('keydown', onKeydown)
  await nextTick()
  panel.value?.querySelector('.picker-trigger')?.focus()
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="close">
      <div
        ref="panel"
        class="modal-panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="`${uid}-title`"
      >

        <div class="modal-header">
          <div>
            <h3 :id="`${uid}-title`">Merge members</h3>
            <p class="sub">
              Combine two records of the same person. One is kept; the other is
              deleted and its reaffiliations move to the one kept.
            </p>
          </div>
          <button class="close-btn" aria-label="Close" :disabled="busy" @click="close">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <div class="modal-body">

          <div class="slots">
            <div class="slot">
              <label :for="`${uid}-keep`">Member to keep</label>
              <button
                :id="`${uid}-keep`"
                type="button"
                class="picker-trigger"
                :class="{ empty: !surviving }"
                :disabled="busy"
                aria-haspopup="dialog"
                @click="openPicker('surviving')"
              >
                <span class="picker-text">{{ memberText(surviving) || 'Choose a member' }}</span>
                <span class="material-symbols-outlined" aria-hidden="true">expand_more</span>
              </button>
            </div>

            <button
              type="button"
              class="swap-btn"
              aria-label="Swap the member to keep and the member to merge away"
              title="Swap"
              :disabled="busy || (!surviving && !removed)"
              @click="swap"
            >
              <span class="material-symbols-outlined">swap_horiz</span>
            </button>

            <div class="slot">
              <label :for="`${uid}-remove`">Member to merge away</label>
              <button
                :id="`${uid}-remove`"
                type="button"
                class="picker-trigger"
                :class="{ empty: !removed }"
                :disabled="busy"
                aria-haspopup="dialog"
                @click="openPicker('removed')"
              >
                <span class="picker-text">{{ memberText(removed) || 'Choose a member' }}</span>
                <span class="material-symbols-outlined" aria-hidden="true">expand_more</span>
              </button>
            </div>
          </div>

          <p v-if="!ready" class="muted hint">
            Choose both members to see how their records will be combined.
          </p>

          <template v-else>
            <div class="warning" role="note">
              <p>
                <strong>{{ fullName(removed) }}</strong>
                (<span class="figure">{{ removed._id }}</span>) will be deleted, and
                their reaffiliations will move to
                <strong>{{ fullName(surviving) }}</strong>
                (<span class="figure">{{ surviving._id }}</span>).
              </p>
              <p v-if="mergedIn.length">
                {{ mergedIn.length }} {{ mergedIn.length === 1 ? 'field' : 'fields' }} will be
                merged in from <span class="figure">{{ removed._id }}</span>:
                {{ mergedIn.map((row) => row.label).join(', ') }}.
              </p>
              <p v-else>
                No fields will be merged in; the kept record stays as it is.
              </p>
              <p v-if="conflictCount">
                {{ conflictCount }} {{ conflictCount === 1 ? 'field differs' : 'fields differ' }}
                between the two. The kept member's value is used unless you pick the
                other one below.
              </p>
              <p v-if="removed.user_id != null">
                <span class="figure">{{ removed._id }}</span> is linked to a user account.
                The merge does not move that link to the kept member.
              </p>
            </div>

            <div class="compare-wrap">
              <table class="compare">
                <thead>
                  <tr>
                    <th scope="col">Field</th>
                    <th scope="col">Keep · <span class="figure">{{ surviving._id }}</span></th>
                    <th scope="col">Merge away · <span class="figure">{{ removed._id }}</span></th>
                    <th scope="col">After merge</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in comparison" :key="row.key" :class="`is-${row.status}`">
                    <th scope="row">{{ row.label }}</th>

                    <template v-if="row.status === 'conflict'">
                      <td>
                        <label class="choice" :class="{ picked: row.from === 'surviving' }">
                          <input
                            type="radio"
                            :name="`${uid}-${row.key}`"
                            :checked="row.from === 'surviving'"
                            :disabled="busy"
                            @change="choices[row.key] = 'surviving'"
                          />
                          {{ row.keep }}
                        </label>
                      </td>
                      <td>
                        <label class="choice" :class="{ picked: row.from === 'removed' }">
                          <input
                            type="radio"
                            :name="`${uid}-${row.key}`"
                            :checked="row.from === 'removed'"
                            :disabled="busy"
                            @change="choices[row.key] = 'removed'"
                          />
                          {{ row.other }}
                        </label>
                      </td>
                    </template>
                    <template v-else>
                      <td :class="{ unused: row.from !== 'surviving' }">{{ blank(row.keep) ? '—' : row.keep }}</td>
                      <td :class="{ unused: row.from !== 'removed' }">{{ blank(row.other) ? '—' : row.other }}</td>
                    </template>

                    <td>
                      <div class="result">
                        <span class="value">{{ row.result }}</span>
                        <span class="tag" :class="row.from === 'removed' ? 'merged' : row.status">
                          {{ row.from === 'removed' ? 'Merged in' : STATUS_TEXT[row.status] }}
                        </span>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>

        </div>

        <div class="modal-footer">
          <button class="btn btn-quiet" :disabled="busy" @click="close">Cancel</button>
          <button class="btn" :disabled="!ready || busy" @click="askConfirm">
            <span class="material-symbols-outlined">merge</span>
            {{ busy ? 'Merging…' : 'Merge users' }}
          </button>
        </div>

      </div>
    </div>

    <OptionPickerModal
      v-if="picking"
      :title="picking === 'surviving' ? 'Choose the member to keep' : 'Choose the member to merge away'"
      :description="
        picking === 'surviving'
          ? 'This record stays, and takes on the reaffiliations of the other.'
          : 'This record is deleted once its details are merged into the kept one.'
      "
      :columns="pickColumns"
      :rows="pickRows"
      :selected-key="(picking === 'surviving' ? surviving : removed)?._id ?? null"
      :page="pickPage"
      :total-pages="pickResult?.total_pages ?? 1"
      :total="pickResult?.total ?? null"
      :loading="pickLoading"
      :error="pickError"
      :option-label="fullName"
      :empty-text="
        pickSearchLoaded
          ? 'No member matches that search. Try another name or student number.'
          : 'No members recorded for this semester yet.'
      "
      @update:page="changePickPage"
      @select="pick"
      @close="picking = null"
    >
      <template #toolbar>
        <div>
          <label :for="`${uid}-pick-sem`">Semester</label>
          <select :id="`${uid}-pick-sem`" v-model="pickSemester" @change="changePickFilter">
            <option value="">All semesters</option>
            <option
              v-for="s in semesters"
              :key="`${s.year}${s.semester}`"
              :value="`${s.year}${s.semester}`"
            >
              {{ s.year }}{{ s.semester }}
            </option>
          </select>
        </div>
        <div class="pick-search">
          <label :for="`${uid}-pick-q`">Search</label>
          <input
            :id="`${uid}-pick-q`"
            v-model="pickSearch"
            type="search"
            placeholder="Name or student number"
          />
        </div>
      </template>
    </OptionPickerModal>

    <DeleteModal
      v-if="confirming"
      title="Merge users"
      confirm-label="Merge users"
      busy-label="Merging…"
      :busy="busy"
      :error="confirmError"
      @close="confirming = false"
      @confirm="confirmMerge"
    >
      Merge <strong>{{ fullName(removed) }}</strong>
      (<span class="figure">{{ removed._id }}</span>) into
      <strong>{{ fullName(surviving) }}</strong>
      (<span class="figure">{{ surviving._id }}</span>)?
      <template v-if="mergedIn.length">
        {{ mergedIn.map((row) => row.label).join(', ') }}
        {{ mergedIn.length === 1 ? 'is' : 'are' }} copied onto the kept record.
      </template>
      <span class="figure">{{ removed._id }}</span> is deleted and its reaffiliations
      move over. This cannot be undone from the dashboard.
    </DeleteModal>
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
  max-width: 820px;
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
  margin: 0;
  font-size: 0.82rem;
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

.close-btn:hover:not(:disabled) {
  background: var(--rule);
  color: var(--ink);
}

.close-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.close-btn .material-symbols-outlined {
  font-size: 1.2rem;
}

/* Body */
.modal-body {
  padding: 1.25rem 1.5rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.hint {
  margin: 0;
  font-size: 0.88rem;
}

/* The two member slots, with the swap button between them. */
.slots {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  gap: 0.75rem;
  align-items: end;
}

/* Looks like the page's selects, but opens the member picker. */
.picker-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  width: 100%;
  font: inherit;
  text-align: left;
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: 2px;
  padding: 0.55rem 0.65rem;
  cursor: pointer;
}

.picker-trigger:focus {
  border-color: var(--maroon);
  outline: none;
}

.picker-trigger:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.picker-trigger.empty .picker-text {
  color: var(--slate);
}

.picker-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-trigger .material-symbols-outlined {
  font-size: 1.2rem;
  color: var(--slate);
}

.swap-btn {
  background: none;
  border: 1px solid var(--rule);
  border-radius: 2px;
  cursor: pointer;
  padding: 0.45rem;
  color: var(--slate);
  display: flex;
  align-items: center;
  line-height: 1;
}

.swap-btn:hover:not(:disabled) {
  border-color: var(--slate);
  color: var(--ink);
}

.swap-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* Merge warning */
.warning {
  border-left: 3px solid var(--ochre);
  background: #fbf6ec;
  padding: 0.7rem 0.9rem;
  font-size: 0.88rem;
  line-height: 1.5;
}

.warning p {
  margin: 0;
}

.warning p + p {
  margin-top: 0.4rem;
}

/* Side-by-side comparison */
.compare-wrap {
  overflow-x: auto;
  border: 1px solid var(--rule);
  border-radius: 2px;
}

.compare {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.86rem;
}

.compare th,
.compare td {
  text-align: left;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid #eef0ec;
  vertical-align: middle;
}

.compare thead th {
  font-weight: 500;
  font-size: 0.78rem;
  color: var(--slate);
  border-bottom-color: var(--rule);
  white-space: nowrap;
}

.compare tbody th {
  font-weight: 500;
  color: var(--slate);
  white-space: nowrap;
}

.compare tbody tr:last-child th,
.compare tbody tr:last-child td {
  border-bottom: 0;
}

.compare tr.is-filled,
.compare tr.is-conflict {
  background: #fbf6ec;
}

/* A value that will not end up on the merged record. */
.compare td.unused {
  color: var(--slate);
  text-decoration: line-through;
  text-decoration-color: var(--rule);
}

.choice {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0;
  font-size: inherit;
  color: var(--slate);
  cursor: pointer;
}

.choice.picked {
  color: var(--ink);
}

.choice input {
  width: auto;
  margin: 0;
  accent-color: var(--maroon);
}

.result {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
}

.result .value {
  font-weight: 500;
}

.tag {
  flex-shrink: 0;
  font-size: 0.72rem;
  padding: 0.1rem 0.45rem;
  border: 1px solid var(--rule);
  border-radius: 2px;
  color: var(--slate);
  background: var(--canvas);
  white-space: nowrap;
}

.tag.merged {
  color: var(--forest);
  border-color: var(--forest);
  background: rgba(15, 74, 52, 0.08);
}

.tag.conflict {
  color: var(--ochre);
  border-color: var(--ochre);
  background: rgba(184, 132, 43, 0.08);
}

.pick-search {
  min-width: 18rem;
}

/* Footer — the merge button sits at the lower right. */
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--rule);
  background: var(--surface);
  position: sticky;
  bottom: 0;
}

.modal-footer .material-symbols-outlined {
  font-size: 1.1rem;
}

@media (max-width: 640px) {
  .slots {
    grid-template-columns: 1fr;
  }

  .swap-btn {
    justify-self: center;
    transform: rotate(90deg);
  }
}
</style>
