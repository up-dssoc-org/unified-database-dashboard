import { api } from '@/api/client'

// The values the API stores for these fields. The edit form offers the same
// lists, so a record can always be found by what it was saved with.
export const YEAR_LEVELS = ['I', 'II', 'III', 'IV', 'V']
export const DESIGNATIONS = ['Associate', 'Fellow']
export const CLASSIFICATIONS = ['Undergraduate', 'Graduate', 'Alumni', 'Researcher', 'Staff']

/**
 * The filters ReaffiliationFilters edits. Every list is "any of" and empty
 * means unfiltered. `degree_id` takes one degree at most, '' for any.
 */
export function emptyReaffFilters() {
  return { degree_id: '', comm_id: [], year_level: [], designation: [], classification: [] }
}

export function hasReaffFilters(filters) {
  return filters.degree_id !== '' || ['comm_id', 'year_level', 'designation', 'classification']
    .some((key) => filters[key].length)
}

/** The filters as `api.getReaffiliations` / `api.getAllReaffiliations` take them. */
export function reaffFilterParams(filters) {
  return {
    degree_id: filters.degree_id === '' ? null : filters.degree_id,
    comm_id: filters.comm_id,
    year_level: filters.year_level,
    designation: filters.designation,
    classification: filters.classification,
  }
}

/**
 * Every degree program, across all pages of `/degrees`, for a dropdown that
 * has to list them all. Pages after the first are fetched together.
 */
export async function loadAllDegrees() {
  const first = await api.getDegrees({ page: 1 })
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, (first?.total_pages ?? 1) - 1) }, (_, i) =>
      api.getDegrees({ page: i + 2 })
    )
  )
  return [first, ...rest].flatMap((res) => res?.data ?? [])
}
