<script setup>
/**
 * Text input that collects comma-separated values as removable chips.
 *
 * The value is an array of strings — `v-model` binds it directly, so an API
 * list (`permissions: ['read:all', …]`) can be handed over as-is and comes back
 * in the same shape. Typing a comma commits everything before it, which also
 * means a whole list can be pasted in one go; Enter commits what is typed so
 * far, and Backspace on an empty input takes the last chip back off.
 *
 * Committing also happens on blur, so a value typed and then left unconfirmed
 * is not silently dropped when the surrounding form is submitted.
 *
 * Blanks and duplicates are discarded rather than reported: they are a
 * consequence of how the text is typed, not something the user asked for.
 */
import { computed, ref } from 'vue'

const props = defineProps({
  /** Current values, in the order the chips render. */
  modelValue: { type: Array, default: () => [] },
  /** Id for the text input, so a caller's `<label for>` points at it. */
  id: { type: String, default: undefined },
  placeholder: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  /** Flags the field as rejected; mirrors `aria-invalid` on the input. */
  invalid: { type: Boolean, default: false },
  /** Id of the caller's error or hint text, for `aria-describedby`. */
  describedby: { type: String, default: undefined },
})

// `input` fires on every edit — typing, committing or removing — so a caller
// can clear a field-level error the way it would for a plain input.
const emit = defineEmits(['update:modelValue', 'input'])

const values = computed(() => props.modelValue ?? [])

// Text typed since the last committed chip. Anything before a comma is
// committed as it is typed, so this only ever holds the trailing fragment.
const draft = ref('')

const input = ref(null)

/** Splits on commas and trims, dropping blanks. */
const parse = (text) =>
  text
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

function add(text) {
  const next = [...values.value]
  for (const part of parse(text)) {
    if (!next.includes(part)) next.push(part)
  }
  if (next.length !== values.value.length) emit('update:modelValue', next)
}

function remove(index) {
  emit('update:modelValue', values.value.filter((_, i) => i !== index))
  emit('input')
  input.value?.focus()
}

function onInput(event) {
  const text = event.target.value
  emit('input')

  if (text.includes(',')) {
    // The fragment after the last comma is still being typed; everything
    // before it is complete.
    const cut = text.lastIndexOf(',')
    add(text.slice(0, cut))
    draft.value = text.slice(cut + 1).trimStart()
  } else {
    draft.value = text
  }

  // Typing a comma can leave `draft` unchanged — a bare comma, or one right
  // after another — and Vue does not patch a value it does not see change, so
  // the field is put back in step by hand.
  if (event.target.value !== draft.value) event.target.value = draft.value
}

function commitDraft() {
  if (!draft.value) return
  add(draft.value)
  draft.value = ''
}

function onBackspace(event) {
  // Only when there is nothing left to delete in the input itself.
  if (draft.value !== '' || !values.value.length) return
  event.preventDefault()
  remove(values.value.length - 1)
}
</script>

<template>
  <div
    class="chips-field"
    :class="{ disabled, invalid }"
    @click="input?.focus()"
  >
    <span v-for="(value, i) in values" :key="value" class="chip figure">
      {{ value }}
      <button
        v-if="!disabled"
        type="button"
        class="chip-remove"
        :aria-label="`Remove ${value}`"
        @click="remove(i)"
      >
        <span class="material-symbols-outlined">close</span>
      </button>
    </span>

    <input
      ref="input"
      :id="id"
      class="chip-input"
      type="text"
      :value="draft"
      :placeholder="values.length ? '' : placeholder"
      :disabled="disabled"
      :aria-invalid="invalid ? 'true' : undefined"
      :aria-describedby="describedby"
      @input="onInput"
      @keydown.enter.prevent="commitDraft"
      @keydown.delete="onBackspace"
      @blur="commitDraft"
    />
  </div>
</template>

<style scoped>
/* Reads as one control: the box carries the border and focus ring, and the
   inner input is stripped back to bare text. */
.chips-field {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.45rem;
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: 2px;
  cursor: text;
  min-height: 2.45rem;
}

.chips-field:focus-within {
  border-color: var(--maroon);
}

.chips-field.invalid {
  border-color: #c0392b;
}

.chips-field.disabled {
  background: var(--canvas);
  cursor: not-allowed;
}

/* Matches the permission chips the tables render. */
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  font-size: 0.72rem;
  padding: 0.1rem 0.2rem 0.1rem 0.45rem;
  background: var(--canvas);
  border: 1px solid var(--rule);
  border-radius: 2px;
  color: var(--ink);
}

.chips-field.disabled .chip {
  padding-right: 0.45rem;
  color: var(--slate);
}

.chip-remove {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: var(--slate);
  display: flex;
  align-items: center;
  border-radius: 2px;
  transition: background 0.12s, color 0.12s;
}

.chip-remove:hover {
  background: var(--rule);
  color: var(--maroon);
}

.chip-remove .material-symbols-outlined {
  font-size: 0.9rem;
}

.chip-input {
  flex: 1 1 7rem;
  min-width: 7rem;
  width: auto;
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 0.2rem 0.1rem;
  font-size: 0.9rem;
}

.chip-input:focus {
  border: none;
  outline: none;
}

.chip-input:disabled {
  cursor: not-allowed;
}
</style>
