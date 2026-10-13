<script setup>
/**
 * Dialog for choosing one record out of a paginated list.
 *
 * Like the other generic modals it is presentational: the caller fetches the
 * current page into `rows`, owns `page` through `v-model:page`, and drives
 * `loading` and `error` while a fetch runs. That keeps it agnostic of the
 * endpoint behind it — any paginated list (`{ data, page, total_pages }`) can
 * back it.
 *
 * Filters, search boxes or sort controls go in the `toolbar` slot. Changing
 * one is the caller's cue to put `page` back to 1 and refetch.
 *
 * Every row carries a Select button. Pressing it emits `select` with the row;
 * the caller takes the value and closes the picker by dropping the `v-if`.
 * The row whose key matches `selectedKey` is marked as the current choice.
 *
 * `columns` and `rowKey` take the same shape as DataTable's, and any
 * `cell:<key>` slot is passed through to it for custom cells.
 *
 * It is meant to stack over another modal (an AddEditModal field opening it,
 * typically), so Escape is caught before it reaches the dialog underneath, and
 * focus goes back to whatever opened it when it closes.
 */
import { computed, nextTick, onMounted, onUnmounted, ref, useId, useSlots } from 'vue'
import DataTable from '@/components/table/DataTable.vue'
import TablePager from '@/components/table/TablePager.vue'
import { readPath } from '@/components/table/useActionDef'

const props = defineProps({
  title: { type: String, default: 'Select an option' },
  /** Optional sentence under the title. */
  description: { type: String, default: '' },
  /** DataTable column descriptors. */
  columns: { type: Array, required: true },
  /** The options on the current page. */
  rows: { type: Array, default: () => [] },
  /** Property name on the row, or `(row, index) => key`. */
  rowKey: { type: [String, Function], default: '_id' },
  /** Key of the option currently chosen, if any — that row is marked. */
  selectedKey: { type: [String, Number], default: null },
  page: { type: Number, default: 1 },
  totalPages: { type: Number, default: 1 },
  /** Total matching options across all pages; shown above the table when set. */
  total: { type: Number, default: null },
  /** Shows a loading line in place of the table while the caller fetches. */
  loading: { type: Boolean, default: false },
  /** Message from a failed fetch, shown in place of the table. */
  error: { type: String, default: '' },
  emptyText: { type: String, default: 'No options to choose from.' },
  selectLabel: { type: String, default: 'Select' },
  selectedLabel: { type: String, default: 'Selected' },
  /** Names an option in the Select button's accessible label. */
  optionLabel: { type: Function, default: null },
})

const emit = defineEmits(['close', 'select', 'update:page'])

const slots = useSlots()
const uid = useId()
const panel = ref(null)

// Only the cell slots are DataTable's; `toolbar` is rendered here.
const cellSlots = computed(() => Object.keys(slots).filter((name) => name.startsWith('cell:')))

function keyOf(row, index) {
  if (typeof props.rowKey === 'function') return props.rowKey(row, index)
  return readPath(row, props.rowKey)
}

const isSelected = (row, index) =>
  props.selectedKey !== null && keyOf(row, index) === props.selectedKey

function selectAria(row) {
  const name = props.optionLabel?.(row)
  return name ? `${props.selectLabel} ${name}` : undefined
}

function close() {
  emit('close')
}

// Caught on window in the capture phase so it runs before the document-level
// Escape handler of a modal underneath, and goes no further — one press closes
// one dialog.
function onKeydown(event) {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  close()
}

// The opener is usually a control in the dialog underneath; hand focus back
// to it so keyboard users land where they left off.
let opener = null

onMounted(async () => {
  opener = document.activeElement
  window.addEventListener('keydown', onKeydown, true)
  await nextTick()
  panel.value?.querySelector('.modal-body select, .modal-body input, .modal-body button')?.focus()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown, true)
  if (opener?.isConnected) opener.focus()
})
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
            <h3 :id="`${uid}-title`">{{ title }}</h3>
            <p v-if="description" class="sub">{{ description }}</p>
          </div>
          <button class="close-btn" aria-label="Close" @click="close">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <div class="modal-body">

          <div v-if="$slots.toolbar" class="toolbar">
            <slot name="toolbar" />
          </div>

          <p v-if="error" class="notice" role="alert">{{ error }}</p>
          <p v-else-if="loading" class="muted status">Loading…</p>

          <template v-else>
            <p v-if="total !== null" class="count">
              <span class="figure">{{ total }}</span> {{ total === 1 ? 'option' : 'options' }}
            </p>

            <DataTable
              :columns="columns"
              :rows="rows"
              :row-key="rowKey"
              actions-label=""
              :show-actions="true"
              :empty-text="emptyText"
            >
              <template v-for="name in cellSlots" #[name]="scope">
                <slot :name="name" v-bind="scope" />
              </template>

              <template #actions="{ row, index }">
                <button
                  v-if="isSelected(row, index)"
                  class="pick-btn chosen"
                  disabled
                  :aria-label="optionLabel ? `${optionLabel(row)} (${selectedLabel})` : undefined"
                >
                  <span class="material-symbols-outlined">check</span>
                  {{ selectedLabel }}
                </button>
                <button
                  v-else
                  class="pick-btn"
                  :aria-label="selectAria(row)"
                  @click="emit('select', row)"
                >
                  {{ selectLabel }}
                </button>
              </template>
            </DataTable>

            <TablePager
              :page="page"
              :total-pages="totalPages"
              @update:page="emit('update:page', $event)"
            />
          </template>

        </div>

      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Sits over the 500-level dialog it is usually opened from. */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(22, 25, 26, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 510;
  padding: 1rem;
}

.modal-panel {
  background: var(--surface);
  border-radius: 0.5rem;
  border: 1px solid var(--rule);
  box-shadow: 0 8px 32px rgba(22, 25, 26, 0.18);
  width: 100%;
  max-width: 760px;
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

.close-btn:hover {
  background: var(--rule);
  color: var(--ink);
}

.close-btn .material-symbols-outlined {
  font-size: 1.2rem;
}

/* Body */
.modal-body {
  padding: 1.25rem 1.5rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.9rem;
  align-items: flex-end;
}

.notice,
.status,
.count {
  margin: 0;
}

.count {
  color: var(--slate);
  font-size: 0.85rem;
}

.count .figure {
  color: var(--ink);
}

/* TablePager carries its own top margin for page layouts; the body gap
   already spaces it here. */
.modal-body :deep(.pager) {
  margin-top: 0;
}

.pick-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font: inherit;
  font-size: 0.8rem;
  padding: 0.3rem 0.7rem;
  border: 1px solid var(--rule);
  border-radius: 2px;
  background: transparent;
  color: var(--ink);
  cursor: pointer;
  white-space: nowrap;
}

.pick-btn:hover:not(:disabled) {
  border-color: var(--maroon);
  color: var(--maroon);
}

.pick-btn.chosen {
  border-color: var(--maroon);
  background: var(--maroon);
  color: #fff;
  cursor: default;
}

.pick-btn .material-symbols-outlined {
  font-size: 1rem;
}
</style>
