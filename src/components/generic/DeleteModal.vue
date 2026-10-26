<script setup>
/**
 * Confirmation dialog for destructive actions.
 *
 * The caller owns the operation: `confirm` fires when the Delete button is
 * pressed, and the modal stays open so the caller can drive `busy` while the
 * request runs and surface `error` in place if it fails. The caller closes it
 * by dropping the `v-if` once the delete succeeds.
 *
 * The wording is the caller's too — pass `modalMessage`, or fill the default
 * slot when the confirmation needs more than a sentence.
 */
import { onMounted, onUnmounted } from 'vue'

const props = defineProps({
  title: { type: String, default: 'Confirm Deletion' },
  /** The custom confirmation message. Ignored when the default slot is used. */
  modalMessage: { type: String, default: 'This action cannot be undone.' },
  confirmLabel: { type: String, default: 'Delete' },
  /** Replaces the confirm label while the caller's operation runs. */
  busyLabel: { type: String, default: 'Deleting…' },
  cancelLabel: { type: String, default: 'Cancel' },
  /** Disables the buttons and shows progress while the caller's delete runs. */
  busy: { type: Boolean, default: false },
  /** Message from a failed delete, rendered above the buttons. */
  error: { type: String, default: '' },
})

const emit = defineEmits(['close', 'confirm'])

// A destructive dialog should not close mid-request, so Escape, the overlay
// and the × are all ignored while `busy`.
function close() {
  if (!props.busy) emit('close')
}

function onKeydown(event) {
  if (event.key === 'Escape') close()
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="close">
      <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title">

        <div class="modal-header">
          <div>
            <h3 id="delete-modal-title">{{ title }}</h3>
          </div>
          <button class="close-btn" aria-label="Close" :disabled="busy" @click="close">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <div class="modal-body">

          <section class="section">
            <slot>{{ modalMessage }}</slot>
          </section>

          <p v-if="error" class="notice" role="alert">{{ error }}</p>

        </div>

        <div class="modal-footer">
          <button class="btn btn-quiet" :disabled="busy" @click="close">{{ cancelLabel }}</button>
          <button class="btn btn-danger" :disabled="busy" @click="emit('confirm')">
            {{ busy ? busyLabel : confirmLabel }}
          </button>
        </div>

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
  padding: 0 1.5rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

/* Section */
.section {
  padding-top: 1.25rem;
  font-size: 0.9rem;
  line-height: 1.5;
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

/* Footer — the confirm button sits at the lower right. */
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

.btn-danger {
  background: #c0392b;
  border-color: #c0392b;
  color: #fff;
}

.btn-danger:hover:not(:disabled) {
  background: #a5321f;
  border-color: #a5321f;
}

.notice {
  margin: 0;
}
</style>
