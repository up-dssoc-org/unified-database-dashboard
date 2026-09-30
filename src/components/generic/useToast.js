/**
 * The shared toast queue.
 *
 * Toasts are fired from anywhere — a view, a store, an API error handler — and
 * rendered by the single `Toast.vue` stack mounted in `App.vue`. The queue is a
 * module-level `reactive` array, so callers never need a provide/inject pair or
 * a component ref:
 *
 *   import { toast } from '@/components/generic/useToast'
 *   toast.success('Committee saved.')
 *   toast.error(err.message, { duration: 0 })   // 0 = stays until dismissed
 *
 * Each call returns the toast's id, which `toast.dismiss(id)` takes back.
 */
import { reactive } from 'vue'

/** How long each variant sits on screen, in ms. Errors linger the longest. */
const DURATIONS = { success: 4000, warning: 6000, error: 8000 }

/**
 * Oldest toasts are dropped past this. A tall stack stops being readable and
 * starts covering the page it is reporting on.
 */
const MAX_VISIBLE = 4

/** Live queue, oldest first. Read by `Toast.vue`; write through `toast`. */
export const toasts = reactive([])

let nextId = 0

function show(variant, message, options = {}) {
  const id = ++nextId

  toasts.push({
    id,
    variant,
    message: String(message ?? ''),
    /** Optional bold line above the message. */
    title: options.title || '',
    /** ms until auto-dismiss; 0 (or null) pins the toast open. */
    duration: options.duration ?? DURATIONS[variant],
  })

  if (toasts.length > MAX_VISIBLE) toasts.splice(0, toasts.length - MAX_VISIBLE)

  return id
}

export const toast = {
  success: (message, options) => show('success', message, options),
  warning: (message, options) => show('warning', message, options),
  error: (message, options) => show('error', message, options),

  dismiss(id) {
    const index = toasts.findIndex((t) => t.id === id)
    if (index !== -1) toasts.splice(index, 1)
  },

  clear() {
    toasts.splice(0)
  },
}
