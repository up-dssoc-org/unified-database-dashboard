<script>
import { ref } from 'vue'

/**
 * Module scope, so every RowActionMenu on the page shares it: opening one
 * menu closes whichever other was open, without relying on click events
 * reaching `document`.
 */
const activeMenu = ref(null)
</script>

<script setup>
/**
 * Overflow ("⋯") row menu with optional one-level submenus, teleported to
 * <body> so it escapes the table's `overflow-x: auto` clipping.
 */
import { computed, onUnmounted, watch } from 'vue'
import { resolve, visibleActions } from './useActionDef'

const props = defineProps({
  /**
   * [{ key, label, icon, danger, disabled, show, onClick, children }]
   * An item with `children` renders as an expandable group instead of a button.
   */
  items: { type: Array, default: () => [] },
  row: { type: Object, default: null },
  ariaLabel: { type: String, default: 'Row actions' },
})

const id = Symbol('row-action-menu')
const open = computed(() => activeMenu.value === id)
const expanded = ref(null)
const pos = ref({ top: 0, left: 0 })

const shown = computed(() => visibleActions(props.items, props.row))

function close() {
  if (open.value) activeMenu.value = null
}

function toggle(event) {
  if (open.value) {
    close()
    return
  }
  const rect = event.currentTarget.getBoundingClientRect()
  pos.value = { top: rect.bottom + 4, left: rect.right }
  activeMenu.value = id
}

// Bound on open rather than inside `toggle` so the listener is also dropped
// when another instance closes this one. The watcher flushes after the
// opening click has finished propagating, so it never self-closes.
watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('click', close)
  } else {
    expanded.value = null
    document.removeEventListener('click', close)
  }
})

function run(item) {
  close()
  item.onClick?.(props.row)
}

function toggleGroup(item) {
  const key = item.key ?? item.label
  expanded.value = expanded.value === key ? null : key
}

const isExpanded = (item) => expanded.value === (item.key ?? item.label)

const childrenOf = (item) => visibleActions(item.children, props.row)

onUnmounted(() => {
  document.removeEventListener('click', close)
  close()
})

defineExpose({ close })
</script>

<template>
  <div class="menu-wrap" @click.stop>
    <button
      class="icon-btn"
      :class="{ active: open }"
      :aria-label="ariaLabel"
      :aria-expanded="String(open)"
      @click="toggle"
    >
      <span class="material-symbols-outlined">more_horiz</span>
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        class="action-menu"
        :style="{ top: `${pos.top}px`, left: `${pos.left}px` }"
        @click.stop
      >
        <template v-for="item in shown" :key="item.key ?? item.label">
          <!-- Expandable group -->
          <div v-if="item.children">
            <button class="action-btn" @click="toggleGroup(item)">
              <span v-if="item.icon" class="material-symbols-outlined">{{ item.icon }}</span>
              {{ resolve(item.label, row) }}
              <span class="material-symbols-outlined caret">
                {{ isExpanded(item) ? 'expand_less' : 'expand_more' }}
              </span>
            </button>
            <div v-if="isExpanded(item)" class="sub-menu">
              <button
                v-for="child in childrenOf(item)"
                :key="child.key ?? child.label"
                class="action-btn sub-btn"
                :class="{ danger: resolve(child.danger, row) }"
                :disabled="resolve(child.disabled, row)"
                @click="run(child)"
              >
                {{ resolve(child.label, row) }}
              </button>
            </div>
          </div>

          <!-- Plain item -->
          <button
            v-else
            class="action-btn"
            :class="{ danger: resolve(item.danger, row) }"
            :disabled="resolve(item.disabled, row)"
            @click="run(item)"
          >
            <span v-if="item.icon" class="material-symbols-outlined">{{ item.icon }}</span>
            {{ resolve(item.label, row) }}
          </button>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.menu-wrap {
  position: relative;
  display: inline-block;
}

.icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.2rem 0.3rem;
  border-radius: 4px;
  color: var(--slate);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s, color 0.12s;
  line-height: 1;
}

.icon-btn:hover,
.icon-btn.active {
  background: var(--rule, #e8eae6);
  color: var(--ink);
}

.icon-btn .material-symbols-outlined {
  font-size: 1.25rem;
}
</style>

<style>
/* Unscoped: the menu is teleported to <body>, outside this component's
   scope-id subtree, so these rules cannot be scoped. */
.action-menu {
  position: fixed;
  transform: translateX(-100%);
  background: #fff;
  border: 1px solid var(--rule, #e8eae6);
  border-radius: 6px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
  min-width: 11rem;
  z-index: 9999;
  overflow: hidden;
}

.action-menu .action-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  font-size: 0.85rem;
  color: var(--ink);
  transition: background 0.1s;
  white-space: nowrap;
}

.action-menu .action-btn:hover:not(:disabled) {
  background: var(--rule, #f0f2ee);
}

.action-menu .action-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.action-menu .action-btn .material-symbols-outlined {
  font-size: 1rem;
  color: var(--slate);
  flex-shrink: 0;
}

.action-menu .action-btn.danger,
.action-menu .action-btn.danger .material-symbols-outlined {
  color: #c0392b;
}

.action-menu .caret {
  margin-left: auto;
  font-size: 1rem !important;
  color: var(--slate) !important;
}

.action-menu .sub-menu {
  border-top: 1px solid var(--rule, #e8eae6);
}

.action-menu .sub-btn {
  padding-left: 2.25rem;
  font-size: 0.82rem;
  color: var(--slate);
}

.action-menu .sub-btn:hover {
  color: var(--ink);
}
</style>
