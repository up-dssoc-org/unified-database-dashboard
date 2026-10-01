<script setup>
import { inject, reactive, ref } from 'vue'
import { api } from '@/api/client'
import posthog from 'posthog-js'

const isPostHogConfigured = inject('isPostHogConfigured')

const showModal = ref(false)
const saving = ref(false)
const saveError = ref('')
const saveSuccess = ref(false)

const form = reactive({
  old_password: '',
  new_password: '',
  confirm_password: ''
})

function resetForm() {
  form.old_password = ''
  form.new_password = ''
  form.confirm_password = ''
}

function openModal() {
  resetForm()
  saveError.value = ''
  saveSuccess.value = false
  showModal.value = true
}

function closeModal() {
  if (saving.value) return
  showModal.value = false
}

async function submitChange() {
  saveError.value = ''

  if (!form.old_password || !form.new_password || !form.confirm_password) {
    saveError.value = 'Fill in all fields.'
    return
  }
  if (form.new_password !== form.confirm_password) {
    saveError.value = 'New passwords do not match.'
    return
  }
  if (form.new_password.length < 8) {
    saveError.value = 'New password must be at least 8 characters.'
    return
  }
  if (form.new_password === form.old_password) {
    saveError.value = 'New password must be different from the current password.'
    return
  }

  saving.value = true
  try {
    await api.changePassword({ old_password: form.old_password, new_password: form.new_password })
    if (isPostHogConfigured) posthog.capture('password_changed')
    saveSuccess.value = true
    resetForm()
  } catch (e) {
    saveError.value = e.detail || e.message || 'Failed to change password.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <button class="btn-quiet btn-change-password" @click="openModal">Change password</button>

  <Teleport to="body">
    <div v-if="showModal" class="modal-overlay" @click.self="closeModal">
      <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="change-password-title">
        <div class="modal-header">
          <h3 id="change-password-title">Change password</h3>
          <button class="btn-quiet close-btn" :disabled="saving" @click="closeModal" aria-label="Close">✕</button>
        </div>

        <form v-if="!saveSuccess" class="modal-form" @submit.prevent="submitChange">
          <div class="form-group">
            <label for="old-password">Current password</label>
            <input
              id="old-password"
              v-model="form.old_password"
              type="password"
              autocomplete="current-password"
              :disabled="saving"
            />
          </div>
          <div class="form-group">
            <label for="new-password">New password</label>
            <input
              id="new-password"
              v-model="form.new_password"
              type="password"
              autocomplete="new-password"
              :disabled="saving"
            />
          </div>
          <div class="form-group">
            <label for="confirm-password">Confirm new password</label>
            <input
              id="confirm-password"
              v-model="form.confirm_password"
              type="password"
              autocomplete="new-password"
              :disabled="saving"
            />
          </div>

          <div class="modal-footer">
            <p v-if="saveError" class="save-error">{{ saveError }}</p>
            <div class="modal-actions">
              <button type="button" class="btn-quiet" :disabled="saving" @click="closeModal">Cancel</button>
              <button type="submit" class="btn" :disabled="saving">
                {{ saving ? 'Saving…' : 'Change password' }}
              </button>
            </div>
          </div>
        </form>

        <div v-else class="modal-form">
          <p class="save-success">Password changed successfully.</p>
          <div class="modal-actions">
            <button type="button" class="btn" @click="closeModal">Done</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.btn-change-password {
  flex-shrink: 0;
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
  max-width: 400px;
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

.save-success {
  font-size: 0.9rem;
  color: var(--ink);
  margin: 0;
}
</style>
