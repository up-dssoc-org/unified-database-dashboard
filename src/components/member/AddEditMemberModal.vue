<script setup>
/**
 * Form dialog for creating or editing a member (POST /members, PATCH
 * /members/members/{dssoc_id}).
 *
 * This is deliberately not an `AddEditModal`: the DSSOC ID is composed from
 * three controls rather than typed as one string, and a member record is a
 * personal document — it reads better as a wide sheet with grouped columns
 * than as one tall scrolling column, so the form spreads across the cross
 * axis and fits on screen without scrolling.
 *
 * Passing `values` puts the modal in edit mode. The DSSOC ID is assigned once
 * and the API has no way to change it, so in that mode the ID group drops its
 * controls and shows the member's own ID back instead, and the "add another"
 * checkbox goes away — an edit is about one record by definition.
 *
 * The caller owns the write: `submit` fires with the request body and whether
 * the editor asked to keep going, and the dialog stays open so the caller can
 * drive `busy` while the request runs and surface `error` in place if it
 * fails. On a successful add the caller either drops the `v-if` or calls the
 * exposed `resetForNext(id)`, which clears the person but keeps the semester
 * and steps the member number to the next one.
 *
 * NOTE: the social links are add-only. POST takes them flat, PATCH takes them
 * nested under `social_media`, and the member record carries only a
 * `social_media_id` — so there is nothing to prefill an edit with. They stay
 * out of edit mode until social media is handled as its own feature.
 */
import { computed, onMounted, onUnmounted, reactive, ref, useId } from 'vue'

const props = defineProps({
  /**
   * Existing member to edit, keyed like the API's member record. Its presence
   * is what puts the modal in edit mode; omit it to create.
   */
  values: { type: Object, default: null },
  /** Add mode only — academic year the ID starts on, e.g. '2526'. */
  defaultYear: { type: String, default: '' },
  /** Add mode only — semester the ID starts on, 'A' or 'B'. */
  defaultSemester: { type: String, default: 'A' },
  /** Disables the form and shows progress while the caller's write runs. */
  busy: { type: Boolean, default: false },
  /** Message from a failed write, rendered above the buttons. */
  error: { type: String, default: '' },
})

const emit = defineEmits(['close', 'submit'])

const editing = computed(() => props.values !== null)

const uid = useId()
const fieldId = (key) => `${uid}-${key}`
const errorId = (key) => `${uid}-err-${key}`

const panel = ref(null)
const yearInput = ref(null)

const ID_DIGITS = 5
const ID_MAX = 10 ** ID_DIGITS - 1

// The three parts of the DSSOC ID are held apart and only joined for the
// payload, so each one can be validated and stepped on its own. In edit mode
// they are read back off the record and never written to.
const idParts = reactive(
  editing.value
    ? splitId(props.values._id)
    : {
        year: /^2\d{3}$/.test(props.defaultYear) ? props.defaultYear : '',
        semester: props.defaultSemester === 'B' ? 'B' : 'A',
        number: '',
      }
)

/** `2526B00001` → its three parts. Anything unexpected is shown as it came. */
function splitId(id) {
  const text = String(id ?? '')
  return { year: text.slice(0, 4), semester: text.slice(4, 5), number: text.slice(5) }
}

/** The person. Keyed exactly as both endpoints spell these fields. */
const form = reactive({
  last_name: '',
  first_name: '',
  middle_name: '',
  suffix: '',
  pronouns: '',
  student_number: '',
  birthday: '',
  contact_number: '',
  personal_email: '',
  up_mail: '',
  // Add only — see the note at the top.
  facebook_profile_url: '',
  linkedin_profile_url: '',
})

// An edit starts from the record; null is how the API spells an unset
// optional, and inputs want ''.
if (editing.value) {
  for (const key of Object.keys(form)) {
    const existing = props.values[key]
    form[key] = existing === undefined || existing === null ? '' : String(existing)
  }
}

// Per-field messages, keyed like `form` plus the three ID keys. Populated on
// submit, and cleared for a field as soon as it is edited.
const fieldErrors = reactive({})

/** Set by `resetForNext`, so a run of additions reads back what it has done. */
const justAdded = ref('')

const addAnother = ref(false)

const paddedNumber = computed(() => idParts.number.padStart(ID_DIGITS, '0'))

const dssocId = computed(() => `${idParts.year}${idParts.semester}${paddedNumber.value}`)

// Shown in place of the ID until all three parts are there, so the editor can
// see the shape of what they are building.
const idPreview = computed(
  () => `${idParts.year || '····'}${idParts.semester}${idParts.number ? paddedNumber.value : '·····'}`
)

const idComplete = computed(() => /^2\d{3}$/.test(idParts.year) && idParts.number !== '')

/** Which fields each endpoint takes — the links are add-only. */
const SOCIAL_KEYS = ['facebook_profile_url', 'linkedin_profile_url']

const fullName = computed(() =>
  [form.first_name, form.middle_name, form.last_name, form.suffix].map((v) => v.trim())
    .filter(Boolean)
    .join(' ')
)

function clearError(key) {
  fieldErrors[key] = ''
  justAdded.value = ''
}

/* ---- DSSOC ID controls (add mode only) ------------------------------------ */

const digitsOnly = (value, max) => String(value ?? '').replace(/\D/g, '').slice(0, max)

function onYearInput(event) {
  idParts.year = digitsOnly(event.target.value, 4)
  event.target.value = idParts.year
  clearError('year')
}

function onNumberInput(event) {
  idParts.number = digitsOnly(event.target.value, ID_DIGITS)
  event.target.value = idParts.number
  clearError('number')
}

/** Pads on blur so a typed `1` settles as `00001`. */
function onNumberBlur() {
  if (idParts.number !== '') idParts.number = paddedNumber.value
}

/**
 * Steps the member number, always leaving it padded. An empty field counts as
 * 00000, so the first tap of the up arrow gives 00001.
 */
function step(by) {
  if (props.busy) return
  const next = Math.min(ID_MAX, Math.max(0, (Number(idParts.number) || 0) + by))
  idParts.number = String(next).padStart(ID_DIGITS, '0')
  clearError('number')
}

function onNumberKeydown(event) {
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    step(1)
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    step(-1)
  }
}

/* ---- Validation ----------------------------------------------------------- */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const BIRTHDAY = /^\d{2}\/\d{2}\/\d{4}$/

function urlProblem(value) {
  const text = value.trim()
  if (!text) return ''
  return /^https?:\/\/\S+$/.test(text) ? '' : 'Start the link with http:// or https://.'
}

function validate() {
  const problems = {
    last_name: form.last_name.trim() ? '' : 'Last name is required.',
    first_name: form.first_name.trim() ? '' : 'First name is required.',
    birthday:
      !form.birthday.trim() || BIRTHDAY.test(form.birthday.trim()) ? '' : 'Use MM/DD/YYYY.',
    personal_email:
      !form.personal_email.trim() || EMAIL.test(form.personal_email.trim())
        ? ''
        : 'That does not look like an email address.',
    up_mail:
      !form.up_mail.trim() || EMAIL.test(form.up_mail.trim())
        ? ''
        : 'That does not look like an email address.',
  }

  // The ID is only typed when it is being assigned.
  if (!editing.value) {
    problems.year = /^2\d{3}$/.test(idParts.year)
      ? ''
      : 'Academic year must be 4 digits, like 2526.'
    problems.number = idParts.number === '' ? 'Member number is required.' : ''
    // Pydantic's HttpUrl wants a scheme, and a bare domain 422s with wording
    // the editor cannot act on.
    for (const key of SOCIAL_KEYS) problems[key] = urlProblem(form[key])
  }

  Object.assign(fieldErrors, problems)
  return Object.values(problems).every((m) => !m)
}

/** Trims text and turns blank optional fields into null. */
const clean = (value) => {
  const text = value.trim()
  return text === '' ? null : text
}

function submit() {
  if (props.busy) return

  if (!validate()) {
    // Put the caret on the first problem rather than making the user hunt.
    panel.value?.querySelector('[aria-invalid="true"]')?.focus()
    return
  }

  const entries = Object.entries(form).filter(
    ([key]) => !(editing.value && SOCIAL_KEYS.includes(key))
  )
  const person = Object.fromEntries(entries.map(([key, value]) => [key, clean(value)]))

  // An edit addresses the record by its own ID, so the payload carries only
  // the fields PATCH accepts.
  emit(
    'submit',
    editing.value ? person : { _id: dssocId.value, ...person },
    { addAnother: !editing.value && addAnother.value }
  )
}

/**
 * Clears the person but keeps the semester and steps the member number, so a
 * batch of members from the same intake can be typed one after another.
 */
function resetForNext(addedId = '') {
  for (const key of Object.keys(form)) form[key] = ''
  for (const key of Object.keys(fieldErrors)) fieldErrors[key] = ''
  step(1)
  justAdded.value = addedId
  panel.value?.querySelector(`#${CSS.escape(fieldId('last_name'))}`)?.focus()
}

defineExpose({ resetForNext })

// A form mid-request should not close under the user, so Escape, the overlay
// and the × are all ignored while `busy`.
function close() {
  if (!props.busy) emit('close')
}

function onKeydown(event) {
  if (event.key === 'Escape') close()
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  // Adding, the ID is the one field with no sensible default, so it takes the
  // caret; editing, it is not a field at all.
  if (editing.value) panel.value?.querySelector(`#${CSS.escape(fieldId('last_name'))}`)?.focus()
  else yearInput.value?.focus()
})
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
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
            <h3 :id="`${uid}-title`">{{ editing ? 'Edit member' : 'Add member' }}</h3>
            <p class="sub">
              <template v-if="editing">
                Updating <strong>{{ fullName || values._id }}</strong>. The DSSOC ID stays as it
                was assigned.
              </template>
              <template v-else>
                Creates a member record. The DSSOC ID is permanent, so check the academic year and
                semester before saving.
              </template>
            </p>
          </div>
          <button class="close-btn" aria-label="Close" :disabled="busy" @click="close">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <form class="modal-body" novalidate @submit.prevent="submit">
          <fieldset class="group id-group">
            <legend>DSSOC ID</legend>

            <!-- Editing: the ID is assigned once and no endpoint changes it,
                 so its parts are read back rather than offered as fields. -->
            <div v-if="editing" class="id-row">
              <p class="readonly">
                <span class="readonly-label">Academic year</span>
                <span class="figure">{{ idParts.year }}</span>
              </p>
              <p class="readonly">
                <span class="readonly-label">Semester</span>
                <span class="figure">{{ idParts.semester }}</span>
              </p>
              <p class="readonly">
                <span class="readonly-label">Member number</span>
                <span class="figure">{{ idParts.number }}</span>
              </p>
              <p class="preview">
                <span class="preview-label">Saved as</span>
                <span class="figure preview-id">{{ values._id }}</span>
              </p>
            </div>

            <div v-else class="id-row">
              <div class="field year">
                <label :for="fieldId('year')">
                  Academic year <span class="req" aria-hidden="true">*</span>
                </label>
                <input
                  :id="fieldId('year')"
                  ref="yearInput"
                  class="figure"
                  type="text"
                  inputmode="numeric"
                  maxlength="4"
                  placeholder="2526"
                  :value="idParts.year"
                  :disabled="busy"
                  :aria-invalid="fieldErrors.year ? 'true' : undefined"
                  :aria-describedby="fieldErrors.year ? errorId('year') : undefined"
                  @input="onYearInput"
                />
                <p v-if="fieldErrors.year" :id="errorId('year')" class="field-error">
                  {{ fieldErrors.year }}
                </p>
                <p v-else class="hint">4 digits, e.g. 2526.</p>
              </div>

              <fieldset class="field sem">
                <legend>Semester <span class="req" aria-hidden="true">*</span></legend>
                <div class="choices">
                  <label
                    v-for="s in ['A', 'B']"
                    :key="s"
                    class="choice"
                    :class="{ picked: idParts.semester === s }"
                  >
                    <input
                      v-model="idParts.semester"
                      type="radio"
                      :value="s"
                      :name="`${uid}-sem`"
                      :disabled="busy"
                    />
                    <span class="figure">{{ s }}</span>
                  </label>
                </div>
              </fieldset>

              <div class="field number">
                <label :for="fieldId('number')">
                  Member number <span class="req" aria-hidden="true">*</span>
                </label>
                <div class="stepper">
                  <input
                    :id="fieldId('number')"
                    class="figure"
                    type="text"
                    inputmode="numeric"
                    maxlength="5"
                    placeholder="00000"
                    :value="idParts.number"
                    :disabled="busy"
                    :aria-invalid="fieldErrors.number ? 'true' : undefined"
                    :aria-describedby="fieldErrors.number ? errorId('number') : undefined"
                    @input="onNumberInput"
                    @blur="onNumberBlur"
                    @keydown="onNumberKeydown"
                  />
                  <span class="spin">
                    <button
                      type="button"
                      aria-label="Increase member number"
                      :disabled="busy"
                      @click="step(1)"
                    >
                      <span class="material-symbols-outlined">keyboard_arrow_up</span>
                    </button>
                    <button
                      type="button"
                      aria-label="Decrease member number"
                      :disabled="busy"
                      @click="step(-1)"
                    >
                      <span class="material-symbols-outlined">keyboard_arrow_down</span>
                    </button>
                  </span>
                </div>
                <p v-if="fieldErrors.number" :id="errorId('number')" class="field-error">
                  {{ fieldErrors.number }}
                </p>
                <p v-else class="hint">Padded to 5 digits.</p>
              </div>

              <p class="preview">
                <span class="preview-label">Will be saved as</span>
                <span class="figure preview-id" :class="{ partial: !idComplete }">
                  {{ idPreview }}
                </span>
              </p>
            </div>
          </fieldset>

          <fieldset class="group">
            <legend>Name</legend>
            <div class="grid">
              <div class="field">
                <label :for="fieldId('last_name')">
                  Last name <span class="req" aria-hidden="true">*</span>
                </label>
                <input
                  :id="fieldId('last_name')"
                  v-model="form.last_name"
                  type="text"
                  placeholder="Dela Cruz"
                  :disabled="busy"
                  :aria-invalid="fieldErrors.last_name ? 'true' : undefined"
                  :aria-describedby="fieldErrors.last_name ? errorId('last_name') : undefined"
                  @input="clearError('last_name')"
                />
                <p v-if="fieldErrors.last_name" :id="errorId('last_name')" class="field-error">
                  {{ fieldErrors.last_name }}
                </p>
              </div>

              <div class="field">
                <label :for="fieldId('first_name')">
                  First name <span class="req" aria-hidden="true">*</span>
                </label>
                <input
                  :id="fieldId('first_name')"
                  v-model="form.first_name"
                  type="text"
                  placeholder="Juan"
                  :disabled="busy"
                  :aria-invalid="fieldErrors.first_name ? 'true' : undefined"
                  :aria-describedby="fieldErrors.first_name ? errorId('first_name') : undefined"
                  @input="clearError('first_name')"
                />
                <p v-if="fieldErrors.first_name" :id="errorId('first_name')" class="field-error">
                  {{ fieldErrors.first_name }}
                </p>
              </div>

              <div class="field">
                <label :for="fieldId('middle_name')">Middle name</label>
                <input
                  :id="fieldId('middle_name')"
                  v-model="form.middle_name"
                  type="text"
                  placeholder="Mendoza"
                  :disabled="busy"
                />
              </div>

              <div class="field">
                <label :for="fieldId('suffix')">Suffix</label>
                <input
                  :id="fieldId('suffix')"
                  v-model="form.suffix"
                  type="text"
                  placeholder="Jr."
                  :disabled="busy"
                />
              </div>

              <div class="field">
                <label :for="fieldId('pronouns')">Pronouns</label>
                <input
                  :id="fieldId('pronouns')"
                  v-model="form.pronouns"
                  type="text"
                  placeholder="they/them"
                  :disabled="busy"
                />
              </div>

              <div class="field">
                <label :for="fieldId('birthday')">Birthday</label>
                <input
                  :id="fieldId('birthday')"
                  v-model="form.birthday"
                  class="figure"
                  type="text"
                  inputmode="numeric"
                  placeholder="01/01/2000"
                  :disabled="busy"
                  :aria-invalid="fieldErrors.birthday ? 'true' : undefined"
                  :aria-describedby="fieldErrors.birthday ? errorId('birthday') : undefined"
                  @input="clearError('birthday')"
                />
                <p v-if="fieldErrors.birthday" :id="errorId('birthday')" class="field-error">
                  {{ fieldErrors.birthday }}
                </p>
              </div>
            </div>
          </fieldset>

          <fieldset class="group">
            <legend>Student &amp; contact</legend>
            <div class="grid">
              <div class="field">
                <label :for="fieldId('student_number')">Student number</label>
                <input
                  :id="fieldId('student_number')"
                  v-model="form.student_number"
                  class="figure"
                  type="text"
                  placeholder="2020-12345"
                  :disabled="busy"
                />
              </div>

              <div class="field">
                <label :for="fieldId('contact_number')">Contact number</label>
                <input
                  :id="fieldId('contact_number')"
                  v-model="form.contact_number"
                  class="figure"
                  type="text"
                  inputmode="tel"
                  placeholder="0917 123 4567"
                  :disabled="busy"
                />
              </div>

              <div class="field">
                <label :for="fieldId('personal_email')">Personal email</label>
                <input
                  :id="fieldId('personal_email')"
                  v-model="form.personal_email"
                  type="text"
                  inputmode="email"
                  placeholder="member@example.com"
                  :disabled="busy"
                  :aria-invalid="fieldErrors.personal_email ? 'true' : undefined"
                  :aria-describedby="
                    fieldErrors.personal_email ? errorId('personal_email') : undefined
                  "
                  @input="clearError('personal_email')"
                />
                <p
                  v-if="fieldErrors.personal_email"
                  :id="errorId('personal_email')"
                  class="field-error"
                >
                  {{ fieldErrors.personal_email }}
                </p>
              </div>

              <div class="field">
                <label :for="fieldId('up_mail')">UP mail</label>
                <input
                  :id="fieldId('up_mail')"
                  v-model="form.up_mail"
                  type="text"
                  inputmode="email"
                  placeholder="member@up.edu.ph"
                  :disabled="busy"
                  :aria-invalid="fieldErrors.up_mail ? 'true' : undefined"
                  :aria-describedby="fieldErrors.up_mail ? errorId('up_mail') : undefined"
                  @input="clearError('up_mail')"
                />
                <p v-if="fieldErrors.up_mail" :id="errorId('up_mail')" class="field-error">
                  {{ fieldErrors.up_mail }}
                </p>
              </div>

              <!-- Add only — see the note at the top of this file. -->
              <div v-if="!editing" class="field">
                <label :for="fieldId('facebook_profile_url')">Facebook profile</label>
                <input
                  :id="fieldId('facebook_profile_url')"
                  v-model="form.facebook_profile_url"
                  type="text"
                  inputmode="url"
                  placeholder="https://facebook.com/member"
                  :disabled="busy"
                  :aria-invalid="fieldErrors.facebook_profile_url ? 'true' : undefined"
                  :aria-describedby="
                    fieldErrors.facebook_profile_url ? errorId('facebook_profile_url') : undefined
                  "
                  @input="clearError('facebook_profile_url')"
                />
                <p
                  v-if="fieldErrors.facebook_profile_url"
                  :id="errorId('facebook_profile_url')"
                  class="field-error"
                >
                  {{ fieldErrors.facebook_profile_url }}
                </p>
              </div>

              <div v-if="!editing" class="field">
                <label :for="fieldId('linkedin_profile_url')">LinkedIn profile</label>
                <input
                  :id="fieldId('linkedin_profile_url')"
                  v-model="form.linkedin_profile_url"
                  type="text"
                  inputmode="url"
                  placeholder="https://linkedin.com/in/member"
                  :disabled="busy"
                  :aria-invalid="fieldErrors.linkedin_profile_url ? 'true' : undefined"
                  :aria-describedby="
                    fieldErrors.linkedin_profile_url ? errorId('linkedin_profile_url') : undefined
                  "
                  @input="clearError('linkedin_profile_url')"
                />
                <p
                  v-if="fieldErrors.linkedin_profile_url"
                  :id="errorId('linkedin_profile_url')"
                  class="field-error"
                >
                  {{ fieldErrors.linkedin_profile_url }}
                </p>
              </div>
            </div>
          </fieldset>

          <p v-if="error" class="notice" role="alert">{{ error }}</p>

          <div class="modal-footer">
            <!-- An edit is about one record, so there is nothing to add more of. -->
            <label v-if="!editing" class="check">
              <input v-model="addAnother" type="checkbox" :disabled="busy" />
              <span>Add another member after this one</span>
            </label>

            <p v-if="justAdded" class="added" role="status">
              Added <span class="figure">{{ justAdded }}</span>
            </p>

            <div class="actions">
              <button type="button" class="btn btn-quiet" :disabled="busy" @click="close">
                Cancel
              </button>
              <button type="submit" class="btn" :disabled="busy">
                <template v-if="editing">{{ busy ? 'Saving…' : 'Save member' }}</template>
                <template v-else>{{ busy ? 'Adding…' : 'Add member' }}</template>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
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

/* Wider than the schema-driven modals: a member record is read across, not
   down, so the fields get three columns instead of one tall stack. */
.modal-panel {
  background: var(--surface);
  border-radius: 0.5rem;
  border: 1px solid var(--rule);
  box-shadow: 0 8px 32px rgba(22, 25, 26, 0.18);
  width: 100%;
  max-width: 60rem;
  max-height: 92vh;
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
  padding: 1.1rem 1.5rem 0.9rem;
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
  max-width: 44rem;
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
  padding: 1rem 1.5rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

/* Groups carry the same hairline treatment as a panel, one step quieter. */
.group {
  margin: 0;
  padding: 0.75rem 1rem 0.9rem;
  border: 1px solid var(--rule);
  border-radius: 2px;
}

.group > legend {
  padding: 0 0.35rem;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--slate);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  gap: 0.7rem 1rem;
}

.field label,
.field legend {
  display: block;
  font-size: 0.85rem;
  color: var(--slate);
  margin-bottom: 0.35rem;
  padding: 0;
}

.req {
  color: var(--maroon);
}

.field-error {
  margin: 0.3rem 0 0;
  font-size: 0.78rem;
  color: #c0392b;
}

.hint {
  margin: 0.3rem 0 0;
  font-size: 0.78rem;
  color: var(--slate);
}

/* DSSOC ID — the three parts sit on one line with the composed ID beside them. */
.id-group {
  background: var(--canvas);
}

.id-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 1rem;
}

.year {
  width: 7.5rem;
}

.sem {
  margin: 0;
  padding: 0;
  border: none;
}

.number {
  width: 11rem;
}

.choices {
  display: flex;
  gap: 0.4rem;
}

.choice {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  padding: 0.5rem 0.75rem;
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: 2px;
  cursor: pointer;
  color: var(--ink);
  font-size: 0.9rem;
}

.choice.picked {
  border-color: var(--maroon);
  box-shadow: inset 2px 0 0 var(--maroon);
}

.choice input {
  width: auto;
  margin: 0;
  accent-color: var(--maroon);
}

/* Member number: text input (so the padding shows) with its own spinner. */
.stepper {
  display: flex;
  align-items: stretch;
}

.stepper input {
  border-radius: 2px 0 0 2px;
  letter-spacing: 0.08em;
}

.spin {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--rule);
  border-left: none;
  border-radius: 0 2px 2px 0;
  overflow: hidden;
}

.spin button {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.9rem;
  padding: 0;
  border: none;
  background: var(--surface);
  color: var(--slate);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.spin button:first-child {
  border-bottom: 1px solid var(--rule);
}

.spin button:hover:not(:disabled) {
  background: var(--rule);
  color: var(--ink);
}

.spin button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.spin .material-symbols-outlined {
  font-size: 1.05rem;
}

/* Editing: the ID parts read as values, not as fields. */
.readonly {
  margin: 0;
}

.readonly-label {
  display: block;
  font-size: 0.85rem;
  color: var(--slate);
  margin-bottom: 0.35rem;
}

.readonly .figure {
  font-size: 1rem;
  color: var(--ink);
}

.preview {
  margin: 0;
  margin-left: auto;
  align-self: center;
  text-align: right;
}

.preview-label {
  display: block;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--slate);
}

.preview-id {
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--ink);
}

.preview-id.partial {
  color: var(--slate);
}

/* Footer — the checkbox stays with the buttons so neither needs a scroll. */
.modal-footer {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  padding: 0.85rem 0;
  border-top: 1px solid var(--rule);
  background: var(--surface);
  position: sticky;
  bottom: 0;
}

.check {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-size: 0.9rem;
  color: var(--ink);
  cursor: pointer;
}

.check input {
  width: auto;
  margin: 0;
  accent-color: var(--maroon);
}

.check input:disabled {
  cursor: not-allowed;
}

.added {
  margin: 0;
  font-size: 0.82rem;
  color: var(--slate);
}

.actions {
  display: flex;
  gap: 0.6rem;
  margin-left: auto;
}

.notice {
  margin: 0;
}
</style>
