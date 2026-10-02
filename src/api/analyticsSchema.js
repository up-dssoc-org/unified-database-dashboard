/**
 * Front-end mirror of the whitelists behind `POST /analytics`.
 *
 * The endpoint assembles its aggregation out of client-supplied parts, and
 * rejects anything it was not told about first: collections, field paths,
 * operators and metrics are each checked server-side. Mirroring those lists
 * here lets the builder offer only valid choices, so a malformed query is
 * caught in the form rather than coming back as a 422.
 *
 * Kept deliberately flat and declarative — when the API's `ALLOWED_FIELDS`
 * gains a field, it is added here too.
 */

/** Alias the endpoint gives the document pulled in by a join. */
export const JOIN_ALIAS = 'joined'

/** Server-side caps, repeated so the form can stop short of them. */
export const MAX_FILTERS = 10
export const MIN_GROUPS = 1
export const MAX_GROUPS = 100
export const DEFAULT_GROUPS = 25

/**
 * `is_deleted` and `metadata` are queryable server-side but are left out of the
 * pickers: soft deletion is already owned by the `include_deleted` toggle, and
 * `metadata` is an embedded document that neither groups nor aggregates into
 * anything readable.
 */
export const COLLECTIONS = [
  {
    value: 'fact_reaffiliation',
    label: 'Reaffiliations',
    note: 'One record per member, per semester.',
    fields: [
      { value: '_id', label: 'Record ID' },
      { value: 'dssoc_id', label: 'DSSoc ID' },
      { value: 'year', label: 'Academic year', numeric: true },
      { value: 'semester', label: 'Semester' },
      { value: 'classification', label: 'Classification' },
      { value: 'designation', label: 'Designation' },
      { value: 'year_level', label: 'Year level', numeric: true },
      { value: 'comm_id', label: 'Committee ID' },
      { value: 'adhoc_committees', label: 'Adhoc committees' },
      { value: 'degree_id', label: 'Degree program ID' },
      { value: 'remarks', label: 'Remarks' },
    ],
  },
  {
    value: 'dim_member',
    label: 'Members',
    note: 'One record per person on the roster.',
    fields: [
      { value: '_id', label: 'DSSoc ID' },
      { value: 'first_name', label: 'First name' },
      { value: 'middle_name', label: 'Middle name' },
      { value: 'last_name', label: 'Last name' },
      { value: 'suffix', label: 'Suffix' },
      { value: 'student_number', label: 'Student number' },
      { value: 'up_mail', label: 'UP mail' },
      { value: 'personal_email', label: 'Personal email' },
      { value: 'contact_number', label: 'Contact number' },
      { value: 'birthday', label: 'Birthday' },
      { value: 'pronouns', label: 'Pronouns' },
      { value: 'is_dssoc_alumni', label: 'Is alumni' },
      { value: 'social_media_id', label: 'Social media ID' },
      { value: 'user_id', label: 'User account ID' },
    ],
  },
  {
    value: 'dim_campus',
    label: 'Campuses',
    fields: [
      { value: '_id', label: 'Campus ID' },
      { value: 'campus_name', label: 'Campus name' },
      { value: 'constituent', label: 'Constituent university' },
      { value: 'year_est', label: 'Year established', numeric: true },
    ],
  },
  {
    value: 'dim_degree_programs',
    label: 'Degree programs',
    fields: [
      { value: '_id', label: 'Degree ID' },
      { value: 'course_name', label: 'Course name' },
      { value: 'campus_id', label: 'Campus ID' },
      { value: 'college', label: 'College' },
      { value: 'college_long', label: 'College (full name)' },
    ],
  },
  {
    value: 'dim_committee',
    label: 'Committees',
    fields: [
      { value: '_id', label: 'Committee ID' },
      { value: 'name', label: 'Committee name' },
      { value: 'category_num', label: 'Category number', numeric: true },
    ],
  },
  {
    value: 'dim_subcommittee',
    label: 'Subcommittees',
    fields: [
      { value: '_id', label: 'Subcommittee ID' },
      { value: 'subcomm_name', label: 'Subcommittee name' },
      { value: 'short_name_subcomm', label: 'Short name' },
      { value: 'short_name_whole', label: 'Short name (full)' },
      { value: 'comm_id', label: 'Committee ID' },
      { value: 'subcategory_num', label: 'Subcategory number', numeric: true },
    ],
  },
  {
    value: 'dim_social_media',
    label: 'Social media',
    fields: [
      { value: '_id', label: 'Record ID' },
      { value: 'social_media_id', label: 'Social media ID' },
      { value: 'facebook_profile_url', label: 'Facebook URL' },
      { value: 'linkedin_profile_url', label: 'LinkedIn URL' },
    ],
  },
]

export const OPERATORS = [
  { value: '$eq', label: 'equals' },
  { value: '$ne', label: 'does not equal' },
  { value: '$gt', label: 'is greater than' },
  { value: '$gte', label: 'is at least' },
  { value: '$lt', label: 'is less than' },
  { value: '$lte', label: 'is at most' },
  { value: '$in', label: 'is any of' },
  { value: '$nin', label: 'is none of' },
  { value: 'is_null', label: 'is empty' },
  { value: 'is_not_null', label: 'is not empty' },
]

/** Operators that take a list rather than a single value. */
export const LIST_OPERATORS = new Set(['$in', '$nin'])
/** Operators that take no value at all. */
export const NULL_OPERATORS = new Set(['is_null', 'is_not_null'])

export const METRICS = [
  { value: '$count', label: 'Count of records', needsField: false },
  { value: '$avg', label: 'Average of', needsField: true },
  { value: '$min', label: 'Minimum of', needsField: true },
  { value: '$max', label: 'Maximum of', needsField: true },
]

/** Operator without the leading `$`, matching what the API echoes back. */
export const metricLabel = (operation) => String(operation ?? '$count').replace(/^\$/, '')

const collectionOf = (value) => COLLECTIONS.find((c) => c.value === value) ?? null

export const collectionLabel = (value) => collectionOf(value)?.label ?? value ?? ''

export const fieldsOf = (value) => collectionOf(value)?.fields ?? []

/**
 * Every field a query may address: the queried collection's own fields, plus
 * the joined collection's under the `joined.` prefix the endpoint expects.
 */
export function addressableFields(collection, join) {
  const own = fieldsOf(collection)
  if (!join?.collection) return own
  const joined = fieldsOf(join.collection).map((f) => ({
    value: `${JOIN_ALIAS}.${f.value}`,
    label: `${f.label} (${collectionLabel(join.collection)})`,
    numeric: f.numeric,
  }))
  return [...own, ...joined]
}

/** Resolves a field path — `joined.` prefix included — to its visible label. */
export function fieldLabel(spec, path) {
  if (!path) return ''
  const joined = path.startsWith(`${JOIN_ALIAS}.`)
  const collection = joined ? spec?.join?.collection : spec?.collection
  const bare = joined ? path.slice(JOIN_ALIAS.length + 1) : path
  const field = fieldsOf(collection).find((f) => f.value === bare)
  if (!field) return path
  return joined ? `${field.label} (${collectionLabel(collection)})` : field.label
}

/**
 * One line describing what a query asks for, shown under each data point's
 * name so ten tiles on one board stay tellable apart.
 */
export function describeSpec(spec) {
  if (!spec) return ''

  const operation = spec.metric?.operation ?? '$count'
  const metric =
    operation === '$count'
      ? 'Count'
      : `${metricLabel(operation)} of ${fieldLabel(spec, spec.metric?.field)}`

  const parts = [`${metric} · ${collectionLabel(spec.collection)}`]
  if (spec.group_by) parts.push(`by ${fieldLabel(spec, spec.group_by)}`)

  const filters = spec.filters?.length ?? 0
  if (filters) parts.push(`${filters} filter${filters === 1 ? '' : 's'}`)
  if (spec.include_deleted) parts.push('deleted included')

  return parts.join(' · ')
}
