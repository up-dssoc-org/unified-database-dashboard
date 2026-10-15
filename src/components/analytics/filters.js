/**
 * Filter logic shared by the query builder and comparison series.
 *
 * In the form, filters are a flat list of rows, each joined to the one before
 * it by AND or OR. In the query, `POST /analytics` takes `filters` (AND-ed) and
 * `any_of` (an `$or` of branches, each AND-ed). The two meet through the usual
 * precedence, AND binding tighter than OR:
 *
 *   A and B or C and D   →   (A and B) or (C and D)   →   any_of: [[A, B], [C, D]]
 *
 * so every OR in the list starts a new branch, and a list with no OR in it is
 * plain `filters`. A query fragment — `{ filters, any_of }` — is the shape both
 * a point's own spec and each of its comparison series carry.
 */
import { LIST_OPERATORS, MAX_BRANCHES, MAX_FILTERS, NULL_OPERATORS } from '@/api/analyticsSchema'

export const CONNECTORS = [
  { value: 'and', label: 'AND' },
  { value: 'or', label: 'OR' },
]

/** A value input is hidden for the null operators and plural for the list ones. */
export const takesValue = (operator) => !NULL_OPERATORS.has(operator)
export const takesList = (operator) => LIST_OPERATORS.has(operator)

/** A new row. `join` is how it attaches to the row before it; the first row's is unused. */
export const blankFilter = () => ({ join: 'and', field: '', operator: '$eq', value: '' })

/**
 * Filter values are typed as text but reach MongoDB as what they look like —
 * `year` is stored as a number and `semester` as a string, and a quoted "2425"
 * would simply match nothing.
 */
function coerceValue(text) {
  const trimmed = String(text ?? '').trim()
  if (trimmed === '') return null
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  const asNumber = Number(trimmed)
  return Number.isNaN(asNumber) ? trimmed : asNumber
}

const coerceList = (text) =>
  String(text ?? '')
    .split(',')
    .map((part) => coerceValue(part))
    .filter((value) => value !== null)

function toCondition(row) {
  const condition = { field: row.field, operator: row.operator }
  if (!takesValue(row.operator)) return condition
  condition.value = takesList(row.operator) ? coerceList(row.value) : coerceValue(row.value)
  return condition
}

/**
 * The way back: a list joins into the comma-separated text the field accepts,
 * and a null operator's absent value stays absent.
 */
function toRow(condition, join) {
  const operator = condition?.operator ?? '$eq'
  let value = ''
  if (takesValue(operator)) {
    if (Array.isArray(condition?.value)) value = condition.value.join(', ')
    else if (condition?.value !== null && condition?.value !== undefined) value = String(condition.value)
  }
  return { join, field: condition?.field ?? '', operator, value }
}

const fragment = (filters, anyOf) => (anyOf.length ? { filters, any_of: anyOf } : { filters })

/** The OR-of-ANDs a fragment selects: one branch per `any_of` entry, each carrying the shared `filters`. */
function branchesOf(query) {
  const shared = query?.filters ?? []
  const anyOf = query?.any_of ?? []
  return anyOf.length ? anyOf.map((branch) => [...shared, ...branch]) : [shared]
}

/** Form rows → query fragment. */
export function queryFromRows(rows) {
  const branches = []
  rows.forEach((row, i) => {
    if (i === 0 || row.join === 'or') branches.push([])
    branches.at(-1).push(toCondition(row))
  })
  return branches.length > 1 ? fragment([], branches) : fragment(branches[0] ?? [], [])
}

/**
 * Query fragment → form rows. A fragment with both `filters` and `any_of` has
 * its shared filters written into every branch, since the list has no way to
 * say "these apply to all of the groups below".
 */
export function rowsFromQuery(query) {
  return branchesOf(query).flatMap((branch, i) =>
    branch.map((condition, j) => toRow(condition, i > 0 && j === 0 ? 'or' : 'and'))
  )
}

/**
 * Both fragments at once. Plain filters simply add up; when both sides are
 * ORs, (A1 or A2) and (B1 or B2) is every pairing of their branches.
 */
export function intersect(a, b) {
  const filters = [...(a?.filters ?? []), ...(b?.filters ?? [])]
  const left = a?.any_of ?? []
  const right = b?.any_of ?? []
  if (!left.length || !right.length) return fragment(filters, left.length ? left : right)
  return fragment(
    filters,
    left.flatMap((x) => right.map((y) => [...x, ...y]))
  )
}

/** Why the endpoint would refuse a fragment's size, or '' when it fits. */
export function sizeProblem(query) {
  const anyOf = query?.any_of ?? []
  if ((query?.filters?.length ?? 0) > MAX_FILTERS) {
    return `more than ${MAX_FILTERS} filters apply to every record`
  }
  if (anyOf.length > MAX_BRANCHES) return `more than ${MAX_BRANCHES} OR groups`
  if (anyOf.some((branch) => branch.length > MAX_FILTERS)) {
    return `an OR group holds more than ${MAX_FILTERS} filters`
  }
  return ''
}

/** The first incomplete row, described for the user, or ''. `subject` names the list ("Filter"). */
export function rowsProblem(rows, subject = 'Filter') {
  for (const [index, row] of rows.entries()) {
    const position = `${subject} ${index + 1}`
    if (!row.field) return `${position} needs a field.`
    if (!takesValue(row.operator)) continue
    if (takesList(row.operator)) {
      if (!coerceList(row.value).length) {
        return `${position} needs at least one value, separated by commas.`
      }
    } else if (String(row.value ?? '').trim() === '') {
      return `${position} needs a value.`
    }
  }
  return ''
}
