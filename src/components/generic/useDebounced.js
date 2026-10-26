import { onScopeDispose, shallowRef, toValue, watch } from 'vue'

/** How long a search input has to sit idle before it reaches the API. */
export const SEARCH_DELAY_MS = 300

/**
 * A copy of `source` (a ref or a getter) that only takes a new value once
 * `source` has stopped changing for `delay` ms. A search box binds to the live
 * value and the fetch watches this one, so a burst of typing costs one request.
 *
 * The watch compares by identity, so an object source should be replaced, not
 * mutated, when it changes. A getter that returns the trimmed text also means
 * a stray space does not count as a new search.
 */
export function useDebounced(source, delay = SEARCH_DELAY_MS) {
  const settled = shallowRef(toValue(source))
  let timer = null

  watch(source, (value) => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      settled.value = value
    }, delay)
  })

  onScopeDispose(() => clearTimeout(timer))

  return settled
}
