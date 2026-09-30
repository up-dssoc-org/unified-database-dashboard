<script setup>
/**
 * The toast stack — one instance, mounted once in `App.vue`.
 *
 * It renders whatever is in the shared queue (`useToast.js`) at the top right
 * of the window, newest at the bottom, and owns the lifetime of each toast:
 * a timer bar drains across the bottom edge for the toast's `duration`, and
 * the toast removes itself from the queue when the bar runs out.
 *
 * Callers never touch this component — they call `toast.success(...)` and the
 * rest. Nothing here is per-view, so there is no reason to mount a second one.
 *
 * Pointing at or tabbing into the stack pauses every timer, not just the one
 * under the cursor: reading the bottom toast should not cost you the one above
 * it. The bars pause with them, so what is on screen keeps matching the clock.
 *
 * Note that `styles.css` kills all animation under `prefers-reduced-motion`,
 * which leaves the bars sitting full. The timers are plain `setTimeout`s and
 * are unaffected, so the toasts still come and go on schedule.
 */
import { onUnmounted, ref, watch } from 'vue'
import { toast, toasts } from './useToast'

const ICONS = { success: 'check_circle', warning: 'warning', error: 'error' }

/** Timer bookkeeping, keyed by toast id: `{ handle, endsAt, remaining }`. */
const timers = new Map()

const paused = ref(false)

function arm(id, ms) {
  const entry = timers.get(id)
  if (!entry) return
  entry.endsAt = Date.now() + ms
  entry.handle = setTimeout(() => toast.dismiss(id), ms)
}

function disarm(id) {
  const entry = timers.get(id)
  if (!entry) return
  clearTimeout(entry.handle)
  entry.handle = null
}

function drop(id) {
  disarm(id)
  timers.delete(id)
}

/**
 * Keeps `timers` in step with the queue. Toasts can also be removed by the
 * caller (`toast.dismiss`/`clear`), so departures are handled here too rather
 * than only on the close button.
 */
watch(
  () => toasts.map((t) => t.id),
  (ids) => {
    for (const id of timers.keys()) {
      if (!ids.includes(id)) drop(id)
    }

    for (const item of toasts) {
      if (timers.has(item.id)) continue
      // A toast with no duration is pinned open: it gets no timer and no bar,
      // and only the close button (or the caller) takes it away.
      if (!item.duration) continue

      timers.set(item.id, { handle: null, endsAt: 0, remaining: item.duration })
      // A toast that arrives while the stack is held stays put until release.
      if (!paused.value) arm(item.id, item.duration)
    }
  },
  { immediate: true }
)

function pause() {
  if (paused.value) return
  paused.value = true
  const now = Date.now()
  for (const [id, entry] of timers) {
    // Un-armed means it arrived mid-pause; its full duration is still owed.
    if (entry.handle) entry.remaining = Math.max(0, entry.endsAt - now)
    disarm(id)
  }
}

function resume() {
  if (!paused.value) return
  paused.value = false
  for (const [id, entry] of timers) arm(id, entry.remaining)
}

onUnmounted(() => {
  for (const id of [...timers.keys()]) drop(id)
})
</script>

<template>
  <Teleport to="body">
    <div
      class="toast-stack"
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      @mouseenter="pause"
      @mouseleave="resume"
      @focusin="pause"
      @focusout="resume"
    >
      <TransitionGroup name="toast">
        <div
          v-for="item in toasts"
          :key="item.id"
          class="toast"
          :class="[`toast-${item.variant}`, { 'is-paused': paused }]"
          :style="{ '--toast-duration': `${item.duration}ms` }"
          :role="item.variant === 'error' ? 'alert' : 'status'"
        >
          <span class="material-symbols-outlined icon" aria-hidden="true">
            {{ ICONS[item.variant] }}
          </span>

          <div class="body">
            <p v-if="item.title" class="title">{{ item.title }}</p>
            <p class="message">{{ item.message }}</p>
          </div>

          <button class="close-btn" aria-label="Dismiss" @click="toast.dismiss(item.id)">
            <span class="material-symbols-outlined">close</span>
          </button>

          <!-- Time left before this toast leaves on its own. -->
          <div v-if="item.duration" class="timer" aria-hidden="true">
            <div class="timer-fill"></div>
          </div>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
/* Above the modals (z-index 500) — a toast reporting on a dialog's write has
   to be visible while that dialog is still open. */
.toast-stack {
  position: fixed;
  top: 1rem;
  right: 1rem;
  z-index: 600;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  width: min(23rem, calc(100vw - 2rem));
  /* The stack is only a layout box; clicks pass through to the page between
     toasts, which re-enable it for themselves. */
  pointer-events: none;
}

.toast {
  pointer-events: auto;
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.7rem 0.9rem 0.85rem;
  background: var(--surface);
  border: 1px solid var(--rule);
  border-left: 3px solid var(--accent);
  border-radius: 2px;
  box-shadow: 0 6px 20px rgba(22, 25, 26, 0.16);
  overflow: hidden;
}

.toast-success {
  --accent: var(--forest);
}

.toast-warning {
  --accent: var(--ochre);
}

.toast-error {
  --accent: #c0392b;
}

.icon {
  color: var(--accent);
  font-size: 1.15rem;
  line-height: 1.3;
  flex-shrink: 0;
}

.body {
  flex: 1;
  min-width: 0;
}

.title {
  margin: 0 0 0.15rem;
  font-size: 0.85rem;
  font-weight: 600;
}

.message {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.45;
  color: var(--slate);
  overflow-wrap: anywhere;
}

.close-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.1rem;
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
  font-size: 1.05rem;
}

/* Timer bar */
.timer {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--rule);
}

.timer-fill {
  height: 100%;
  background: var(--accent);
  transform-origin: left;
  animation: toast-drain var(--toast-duration) linear forwards;
}

.is-paused .timer-fill {
  animation-play-state: paused;
}

@keyframes toast-drain {
  from {
    transform: scaleX(1);
  }
  to {
    transform: scaleX(0);
  }
}

/* Enter from the right, then let the stack close the gap on leave. */
.toast-enter-from {
  opacity: 0;
  transform: translateX(0.75rem);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(0.75rem);
}

.toast-enter-active,
.toast-leave-active,
.toast-move {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.toast-leave-active {
  position: absolute;
  right: 0;
  width: 100%;
}
</style>
