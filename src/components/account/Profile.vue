<script setup>
import { computed, inject, reactive, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/api/client'
import posthog from 'posthog-js'

const isPostHogConfigured = inject('isPostHogConfigured')
const auth = useAuthStore();
const member = computed(() => auth.member)
const isLinked = computed(() => auth.isLinkedMember)
const isAdmin = computed(() => auth.isAdmin)

// NOTE: link-member modal not implemented yet
function openLinkModal() {}

function formatKey(key) {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatValue(val) {
  if (val == '' || val == null) {
    return 'None'
  }
  return val
}

// NOTE: include is_dssoc_alumni in the future
const excludedFields = ['social_media_id', 'user_id', 'metadata', 'is_dssoc_alumni']

const memberEntries = computed(() => {
  if (!member.value || typeof member.value !== 'object') return []
  return Object.entries(member.value).filter(([k, v]) => v !== undefined && !excludedFields.includes(k))
})

// --- Edit modal ---
const showModal = ref(false)
const saving = ref(false)
const saveError = ref('')

const EDITABLE_FIELDS = [
  { key: 'student_number', label: 'Student Number', type: 'text' },
  { key: 'last_name',      label: 'Last Name',      type: 'text' },
  { key: 'first_name',     label: 'First Name',     type: 'text' },
  { key: 'middle_name',    label: 'Middle Name',    type: 'text' },
  { key: 'suffix',         label: 'Suffix',         type: 'text' },
  { key: 'pronouns',       label: 'Pronouns',       type: 'text' },
  { key: 'birthday',       label: 'Birthday',       type: 'date' }, // NOTE: api bday = text -> coerce into date first
  { key: 'contact_number', label: 'Contact Number', type: 'text' },
  { key: 'personal_email', label: 'Personal Email', type: 'email' },
  { key: 'up_mail',        label: 'UP Mail',        type: 'email' },
]

const form = reactive(Object.fromEntries(EDITABLE_FIELDS.map(f => [f.key, ''])))

// Birthday: API stores mm/dd/YYYY; <input type="date"> needs YYYY-MM-DD.
// The writable computed translates between the two so v-model works normally.
const formattedDate = computed({
  get() {
    const val = form.birthday
    if (!val) return ''
    const [mm, dd, yyyy] = val.split('/')
    // NOTE: birthday data from unified database does not properly account for string padding
    return yyyy && mm && dd ? `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}` : ''
  },
  set(val) {
    if (!val) { form.birthday = ''; return }
    const [yyyy, mm, dd] = val.split('-')
    form.birthday = yyyy && mm && dd ? `${mm}/${dd}/${yyyy}` : ''
  }
})

function openModal() {
  const m = member.value ?? {}
  for (const { key } of EDITABLE_FIELDS) {
    form[key] = m[key] ?? ''
  }
  saveError.value = ''
  showModal.value = true
}

function closeModal() {
  if (saving.value) return
  showModal.value = false
}

async function submitEdit() {
  saving.value = true
  saveError.value = ''
  try {
    const payload = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, v === '' ? null : v])
    )
    const updated = await api.editMember(member?.value?._id, payload)
    auth.updateMember(updated ?? payload)
    if (isPostHogConfigured) posthog.capture('member_profile_updated')
    showModal.value = false
  } catch (e) {
    saveError.value = e.detail || e.message || 'Failed to save changes.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section v-if="!isLinked" class="panel member-section">
    <div class="section-header">
      <div>
        <h2>Member data</h2>
        <p class="panel-note">This account is not linked to a member record.</p>
      </div>
    </div>
    <div v-if="isAdmin" class="link-prompt">
      <p>As an administrator, you can link this account to a member record yourself.</p>
      <button class="btn" @click="openLinkModal">Link member record</button>
    </div>
    <p v-else class="muted">
      Ask an administrator to link your account to your member record to view and edit your member data.
    </p>
  </section>

  <section v-else class="panel member-section">
    <div class="section-header">
      <div>
        <h2>Member data</h2>
        <p class="panel-note">Information from the membership database linked to this account.</p>
      </div>
      <button v-if="member" class="btn-quiet btn-edit" @click="openModal">Edit</button>
    </div>
    <dl v-if="memberEntries?.length" class="fields">
      <div v-for="[key, value] in memberEntries" :key="key" class="field-row">
        <dt>{{ formatKey(key) }}</dt>
        <dd class="figure">{{ formatValue(value) }}</dd>
      </div>
    </dl>
    <p v-else class="muted">No member data available.</p>
  </section>

  <Teleport to="body">
    <div v-if="showModal" class="modal-overlay" @click.self="closeModal">
      <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="edit-modal-title">
        <div class="modal-header">
          <h3 id="edit-modal-title">Edit member data</h3>
          <button class="btn-quiet close-btn" :disabled="saving" @click="closeModal" aria-label="Close">✕</button>
        </div>

        <form class="modal-form" @submit.prevent="submitEdit">
          <div class="form-grid">
            <div v-for="field in EDITABLE_FIELDS" :key="field.key" class="form-group">
              <label :for="`edit-${field.key}`">{{ field.label }}</label>
              <!-- All fields except birthday use v-model directly -->
              <input
                v-if="field.key !== 'birthday'"
                :id="`edit-${field.key}`"
                v-model="form[field.key]"
                :type="field.type"
                :placeholder="field.label"
                :disabled="saving"
                autocomplete="off"
              />
              <!-- Birthday: formattedDate computed converts mm/dd/YYYY <-> YYYY-MM-DD for the date picker -->
              <input
                v-else
                :id="`edit-${field.key}`"
                type="date"
                v-model="formattedDate"
                :disabled="saving"
              />
            </div>
          </div>

          <div class="modal-footer">
            <p v-if="saveError" class="save-error">{{ saveError }}</p>
            <div class="modal-actions">
              <button type="button" class="btn-quiet" :disabled="saving" @click="closeModal">Cancel</button>
              <button type="submit" class="btn" :disabled="saving">
                {{ saving ? 'Saving…' : 'Save changes' }}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.member-section {
  display: flex;
  flex-direction: column;
}

.section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.25rem;
}

.section-header h2 {
  margin: 0;
}

.section-header .panel-note {
  margin: 0.15rem 0 0;
}

.btn-edit {
  flex-shrink: 0;
  margin-top: 0.15rem;
}

.link-prompt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  padding-top: 0.5rem;
}

.link-prompt p {
  margin: 0;
  font-size: 0.9rem;
}

.fields {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.field-row {
  display: grid;
  grid-template-columns: 10rem 1fr;
  gap: 0.5rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--rule);
  align-items: baseline;
}

.field-row:last-child {
  border-bottom: none;
}

dt {
  font-size: 0.82rem;
  color: var(--slate);
}

dd {
  margin: 0;
  font-size: 0.9rem;
  word-break: break-word;
}

/* Modal */
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
  max-width: 560px;
  max-height: 90vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem 1rem;
  border-bottom: 1px solid var(--rule);
}

.modal-header h3 {
  margin: 0;
  font-size: 1rem;
}

.close-btn {
  padding: 0.25rem 0.5rem;
  font-size: 0.85rem;
  line-height: 1;
}

.modal-form {
  padding: 1.25rem 1.5rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.form-group label {
  font-size: 0.78rem;
  color: var(--slate);
  font-weight: 500;
}

.form-group input {
  font-family: var(--font);
  font-size: 0.88rem;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--rule);
  border-radius: 0.3rem;
  background: var(--canvas);
  color: var(--ink);
  outline: none;
  transition: border-color 0.15s;
  width: 100%;
  box-sizing: border-box;
}

.form-group input:focus {
  border-color: var(--maroon);
}

.form-group input:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.modal-footer {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.save-error {
  font-size: 0.85rem;
  color: var(--maroon);
  margin: 0;
}
</style>
