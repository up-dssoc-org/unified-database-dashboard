<script setup>
/**
 * Dialog for saving the analytics board as a file.
 *
 * Two choices: the format (PNG, SVG or PDF, see `EXPORT_FORMATS`), and whether
 * a header — a title, an optional subtitle and optionally today's date — goes
 * across the top of the page.
 *
 * The caller owns the export: `submit` fires with `{ format, header }`, where
 * `header` is `null` or `{ title, subtitle, date }`, and the dialog stays open
 * so the caller can drive `busy` while the file is built and surface `error`
 * in place if it fails. The caller closes it by dropping the `v-if`.
 */
import { computed, onMounted, onUnmounted, reactive, ref, useId } from 'vue'
import { EXPORT_FORMATS } from './boardExport'

const props = defineProps({
  /** How many data points the export will hold, for the dialog's wording. */
  count: { type: Number, default: 0 },
  /** Disables the form and shows progress while the caller builds the file. */
  busy: { type: Boolean, default: false },
  /** Message from a failed export, rendered above the buttons. */
  error: { type: String, default: '' },
})

const emit = defineEmits(['close', 'submit'])

const uid = useId()
const fieldId = (key) => `${uid}-${key}`
const panel = ref(null)

const form = reactive({
  format: 'png',
  withHeader: false,
  title: 'Analytics dashboard',
  subtitle: '',
  date: true,
})

/** Set on submit, cleared as soon as the form is touched again. */
const formError = ref('')

const formatLabel = computed(
  () => EXPORT_FORMATS.find((f) => f.value === form.format)?.label ?? ''
)

function submit() {
  if (props.busy) return

  const title = form.title.trim()
  if (form.withHeader && !title) {
    formError.value = 'A header needs a title, or turn the header off.'
    return
  }
  formError.value = ''

  emit('submit', {
    format: form.format,
    header: form.withHeader ? { title, subtitle: form.subtitle.trim(), date: form.date } : null,
  })
}

// A file mid-build should not lose its dialog, so Escape, the overlay and the
// × are all ignored while `busy`.
function close() {
  if (!props.busy) emit('close')
}

function onKeydown(event) {
  if (event.key === 'Escape') close()
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  panel.value?.querySelector('input')?.focus()
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
            <h3 :id="`${uid}-title`">Export dashboard</h3>
            <p class="sub">
              Saves all {{ count }} data {{ count === 1 ? 'point' : 'points' }} on one page, in the
              order they are on the board.
            </p>
          </div>
          <button class="close-btn" aria-label="Close" :disabled="busy" @click="close">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <form class="modal-body" novalidate @submit.prevent="submit" @input="formError = ''">
          <fieldset class="group">
            <legend>Format</legend>
            <div class="choices">
              <label
                v-for="f in EXPORT_FORMATS"
                :key="f.value"
                class="choice"
                :class="{ picked: form.format === f.value }"
              >
                <input v-model="form.format" type="radio" :value="f.value" :disabled="busy" />
                <span>
                  <strong>{{ f.label }}</strong>
                  <em>{{ f.note }}</em>
                </span>
              </label>
            </div>
          </fieldset>

          <fieldset class="group">
            <legend>Header</legend>

            <label class="check">
              <input v-model="form.withHeader" type="checkbox" :disabled="busy" />
              <span>Add a header at the top of the page</span>
            </label>

            <template v-if="form.withHeader">
              <div class="field">
                <label :for="fieldId('title')">Title</label>
                <input
                  :id="fieldId('title')"
                  v-model="form.title"
                  type="text"
                  placeholder="Analytics dashboard"
                  :disabled="busy"
                />
                <p class="hint">Also used for the file name.</p>
              </div>

              <div class="field">
                <label :for="fieldId('subtitle')">Subtitle</label>
                <input
                  :id="fieldId('subtitle')"
                  v-model="form.subtitle"
                  type="text"
                  placeholder="Reaffiliation figures for the general assembly"
                  :disabled="busy"
                />
                <p class="hint">Optional. Shown under the title.</p>
              </div>

              <label class="check">
                <input v-model="form.date" type="checkbox" :disabled="busy" />
                <span>Show today's date</span>
              </label>
            </template>
          </fieldset>

          <p v-if="formError || error" class="notice" role="alert">{{ formError || error }}</p>

          <div class="modal-footer">
            <button type="button" class="btn btn-quiet" :disabled="busy" @click="close">
              Cancel
            </button>
            <button type="submit" class="btn" :disabled="busy">
              <span class="material-symbols-outlined">download</span>
              {{ busy ? 'Exporting…' : `Save as ${formatLabel}` }}
            </button>
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

.modal-body {
  padding: 1.25rem 1.5rem 0;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

/* Groups carry the same hairline treatment as a panel, one step quieter. */
.group {
  margin: 0;
  padding: 0.9rem 1rem 1rem;
  border: 1px solid var(--rule);
  border-radius: 2px;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.group legend {
  padding: 0 0.35rem;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--slate);
}

.field label {
  margin-bottom: 0.35rem;
}

/* Each format reads as a card rather than a bare radio. */
.choices {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.choice {
  flex: 1 1 9rem;
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  margin: 0;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--rule);
  border-radius: 2px;
  cursor: pointer;
  color: var(--ink);
}

.choice.picked {
  border-color: var(--maroon);
  box-shadow: inset 2px 0 0 var(--maroon);
}

.choice input {
  width: auto;
  margin: 0.2rem 0 0;
  accent-color: var(--maroon);
}

.choice strong {
  display: block;
  font-size: 0.9rem;
  font-weight: 600;
}

.choice em {
  display: block;
  font-style: normal;
  font-size: 0.78rem;
  color: var(--slate);
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

.hint {
  margin: 0.3rem 0 0;
  font-size: 0.8rem;
  color: var(--slate);
}

.notice {
  margin: 0;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  padding: 1rem 0;
  margin-top: 0.25rem;
  border-top: 1px solid var(--rule);
  background: var(--surface);
  position: sticky;
  bottom: 0;
}

.modal-footer .material-symbols-outlined {
  font-size: 1.1rem;
}
</style>
