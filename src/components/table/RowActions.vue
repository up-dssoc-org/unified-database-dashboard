<script setup>
/**
 * Inline row action buttons — the "Edit / Delete" pair used by the manage
 * views. Rendered by DataTable as the default contents of the actions cell.
 */
import { computed } from 'vue'
import { resolve, visibleActions } from './useActionDef'

const props = defineProps({
  /**
   * [{ key, label, icon, danger, accent, disabled, show, ariaLabel, onClick }]
   * `danger`, `accent`, `disabled`, `show` and `ariaLabel` may each be a
   * `(row) => value` function.
   *
   * `danger` is the red destructive treatment; `accent` is the blue highlight
   * for the action that undoes one (Restore).
   */
  actions: { type: Array, default: () => [] },
  row: { type: Object, default: null },
})

const shown = computed(() => visibleActions(props.actions, props.row))

const labelFor = (action) => resolve(action.ariaLabel, props.row) || resolve(action.label, props.row)
</script>

<template>
  <div class="row-actions">
    <button
      v-for="action in shown"
      :key="action.key ?? action.label"
      class="row-btn"
      :class="{ danger: resolve(action.danger, row), accent: resolve(action.accent, row) }"
      :aria-label="labelFor(action)"
      :disabled="resolve(action.disabled, row)"
      @click="action.onClick?.(row)"
    >
      <span v-if="action.icon" class="material-symbols-outlined">{{ action.icon }}</span>
      {{ resolve(action.label, row) }}
    </button>
  </div>
</template>

<style scoped>
.row-actions {
  display: inline-flex;
  gap: 0.4rem;
}

.row-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem 0.6rem;
  background: transparent;
  border: 1px solid var(--rule);
  border-radius: 2px;
  color: var(--ink);
  font-size: 0.82rem;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}

.row-btn:hover:not(:disabled) {
  background: #fff;
  border-color: var(--slate);
}

.row-btn .material-symbols-outlined {
  font-size: 1rem;
  color: var(--slate);
}

.row-btn.danger {
  color: #c0392b;
}

.row-btn.danger .material-symbols-outlined {
  color: #c0392b;
}

.row-btn.danger:hover:not(:disabled) {
  border-color: #c0392b;
}

/* Blue highlight for the action that reverses a delete. */
.row-btn.accent {
  color: var(--steel);
  border-color: var(--steel);
  background: rgba(62, 92, 118, 0.08);
}

.row-btn.accent .material-symbols-outlined {
  color: var(--steel);
}

.row-btn.accent:hover:not(:disabled) {
  background: rgba(62, 92, 118, 0.16);
  border-color: var(--steel);
}

.row-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
