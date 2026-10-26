<script setup>
/**
 * A dropdown that picks any number of options, for filters where the API takes
 * "any of these" (`?designation=Associate,Fellow`).
 *
 * The closed control looks like the page's native selects and names what is
 * chosen: the placeholder when nothing is, the option itself when one is, a
 * count past that. Opening it shows a checkbox per option; nothing chosen
 * means no filter, which is what the Clear button goes back to.
 *
 * `v-model` is the array of chosen values, and each change emits a new array
 * rather than mutating the old one, so a caller can watch it by identity.
 *
 * Options are `{ value, label, group? }`. Options sharing a `group` are listed
 * under it as a heading, in the order they first appear.
 */
import { computed, nextTick, onUnmounted, ref, useId, watch } from 'vue'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  options: { type: Array, default: () => [] },
  /** Id for the trigger button, so an outside `<label for>` can name it. */
  id: { type: String, default: null },
  /** Shown when nothing is chosen. */
  placeholder: { type: String, default: 'Any' },
  disabled: { type: Boolean, default: false },
  /** Shown in place of the placeholder while the caller fetches options. */
  loading: { type: Boolean, default: false },
  /** Shown in the open list when there are no options. */
  emptyText: { type: String, default: 'No options.' },
})

const emit = defineEmits(['update:modelValue'])

const uid = useId()
const root = ref(null)
const trigger = ref(null)
const open = ref(false)

const chosen = computed(() => new Set(props.modelValue))

const groups = computed(() => {
  const out = new Map()
  for (const option of props.options) {
    const key = option.group ?? ''
    if (!out.has(key)) out.set(key, [])
    out.get(key).push(option)
  }
  return [...out].map(([label, options]) => ({ label, options }))
})

const summary = computed(() => {
  if (props.loading) return 'Loading…'
  const picked = props.options.filter((o) => chosen.value.has(o.value))
  if (!picked.length) return props.placeholder
  if (picked.length === 1) return picked[0].label
  return `${picked.length} selected`
})

function toggle(value) {
  emit(
    'update:modelValue',
    chosen.value.has(value)
      ? props.modelValue.filter((v) => v !== value)
      : [...props.modelValue, value]
  )
}

function clear() {
  emit('update:modelValue', [])
}

function close({ refocus = false } = {}) {
  open.value = false
  if (refocus) trigger.value?.focus()
}

async function toggleOpen() {
  if (props.disabled) return
  open.value = !open.value
  if (!open.value) return
  await nextTick()
  root.value?.querySelector('.menu input')?.focus()
}

// A click or a Tab that lands outside the control closes it, the way a native
// select gives up focus.
function onPointerDown(event) {
  if (!root.value?.contains(event.target)) close()
}

// Only a move to a known element counts: Safari does not focus a checkbox on
// click, so a click inside the menu blurs with no `relatedTarget`, and clicks
// outside are already handled on pointerdown.
function onFocusOut(event) {
  const next = event.relatedTarget
  if (open.value && next && !root.value?.contains(next)) close()
}

function onKeydown(event) {
  if (event.key !== 'Escape' || !open.value) return
  // Taken here so a modal this sits in does not close along with it.
  event.stopPropagation()
  close({ refocus: true })
}

watch(open, (isOpen) => {
  if (isOpen) document.addEventListener('pointerdown', onPointerDown)
  else document.removeEventListener('pointerdown', onPointerDown)
})

watch(() => props.disabled, (disabled) => {
  if (disabled) close()
})

onUnmounted(() => document.removeEventListener('pointerdown', onPointerDown))
</script>

<template>
  <div ref="root" class="multi" @keydown="onKeydown" @focusout="onFocusOut">
    <button
      :id="id"
      ref="trigger"
      type="button"
      class="trigger"
      :class="{ empty: !modelValue.length || loading }"
      :disabled="disabled"
      aria-haspopup="true"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="`${uid}-menu`"
      @click="toggleOpen"
    >
      <span class="trigger-text">{{ summary }}</span>
      <span class="material-symbols-outlined" aria-hidden="true">expand_more</span>
    </button>

    <div v-if="open" :id="`${uid}-menu`" class="menu">
      <div class="menu-head">
        <span class="figure">{{ modelValue.length }}</span>&nbsp;selected
        <button type="button" class="clear" :disabled="!modelValue.length" @click="clear">
          Clear
        </button>
      </div>

      <p v-if="!options.length" class="muted none">{{ emptyText }}</p>

      <div
        v-for="group in groups"
        :key="group.label"
        role="group"
        :aria-labelledby="group.label ? `${uid}-g-${group.label}` : undefined"
      >
        <p v-if="group.label" :id="`${uid}-g-${group.label}`" class="group">{{ group.label }}</p>
        <label
          v-for="option in group.options"
          :key="option.value"
          class="option"
          :class="{ picked: chosen.has(option.value) }"
        >
          <input
            type="checkbox"
            :checked="chosen.has(option.value)"
            @change="toggle(option.value)"
          />
          <span>{{ option.label }}</span>
        </label>
      </div>
    </div>
  </div>
</template>

<style scoped>
.multi {
  position: relative;
}

/* Matches the global select. */
.trigger {
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

.trigger:focus,
.trigger[aria-expanded='true'] {
  border-color: var(--maroon);
  outline: none;
}

.trigger:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.trigger.empty .trigger-text {
  color: var(--slate);
}

.trigger-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trigger .material-symbols-outlined {
  font-size: 1.2rem;
  color: var(--slate);
}

.menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 50;
  min-width: 100%;
  width: max-content;
  max-width: 22rem;
  max-height: 18rem;
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: 2px;
  box-shadow: 0 4px 16px rgba(22, 25, 26, 0.12);
  padding: 0.3rem 0;
}

.menu-head {
  display: flex;
  align-items: center;
  padding: 0.25rem 0.75rem 0.4rem;
  margin-bottom: 0.2rem;
  border-bottom: 1px solid var(--rule);
  font-size: 0.8rem;
  color: var(--slate);
}

.clear {
  margin-left: auto;
  background: none;
  border: none;
  padding: 0.1rem 0.2rem;
  font-size: 0.8rem;
  color: var(--maroon);
  cursor: pointer;
}

.clear:disabled {
  color: var(--slate);
  opacity: 0.55;
  cursor: default;
}

.none {
  margin: 0;
  padding: 0.4rem 0.75rem;
  font-size: 0.85rem;
}

.group {
  margin: 0;
  padding: 0.45rem 0.75rem 0.15rem;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--slate);
}

/* Scoped through `.option` so it outranks the global label rule. */
.menu .option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  padding: 0.35rem 0.75rem;
  font-size: 0.88rem;
  color: var(--ink);
  cursor: pointer;
}

.menu .option:hover {
  background: var(--canvas);
}

/* The global input rule would otherwise stretch the checkbox and pad it. */
.option input[type='checkbox'] {
  flex-shrink: 0;
  width: auto;
  margin: 0;
  padding: 0;
  accent-color: var(--maroon);
  cursor: inherit;
}
</style>
