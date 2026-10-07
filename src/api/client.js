import axios from "axios";

const BASE = (import.meta.env.VITE_API_BASE_URL || window.location.origin).replace(/\/$/, '')
const BYPASS = import.meta.env.VITE_VERCEL_BYPASS

export class ApiError extends Error {
  constructor(status, detail) {
    super(detail)
    this.status = status
    this.detail = detail
  }
}

let getToken = () => null
let onUnauthorized = () => {}
let refreshSession = async () => null
export function configureAuth({ tokenGetter, unauthorizedHandler, sessionRefresher }) {
  getToken = tokenGetter
  onUnauthorized = unauthorizedHandler
  if (sessionRefresher) refreshSession = sessionRefresher
}

function defaultMessage(status) {
  switch (status) {
    case 401: return 'Your session ended. Sign in again.'
    case 403: return 'Your account does not have access to this data.'
    case 404: return 'Nothing found for that request.'
    case 429: return 'Too many requests. Wait a minute, then retry.'
    case 503: return 'The database is unavailable right now. Try again shortly.'
    default: return 'Something went wrong on the server.'
  }
}


const instance = axios.create({ 
  baseURL: BASE, 
  timeout: 5000, 
  headers: { 
    Accept: 'application/json', 
    ...(BYPASS && {'x-vercel-protection-bypass': BYPASS}) 
  } 
})


// `skipAuth` marks the public endpoints — login, refresh, /meta/semesters. They
// must not carry the stored access token, and a 401 from one of them does not
// mean the session ended.
instance.interceptors.request.use((config) => {
  if (!config.skipAuth) {
    config._generation = generation
    const token = getToken()
    if (token) config.headers.set('Authorization', `Bearer ${token}`)
  }
  return config
})

// POST /refresh rotates the pair and revokes the old one, so concurrent 401s
// have to share one refresh instead of racing each other into a revoked token.
let refreshing = null
let generation = 0

async function refreshOnce(seenGeneration) {
  // someone already refreshed since this request was stamped
  if (seenGeneration !== undefined && seenGeneration !== generation) return getToken()
  if (!refreshing) {
    refreshing = Promise.resolve()
      .then(() => refreshSession())
      .then((t) => { generation += 1; return t })
      .finally(() => { refreshing = null })
  }
  try { return await refreshing } catch { return null }
}


// axios rejects every non-2xx response, so this is the one place where HTTP and
// transport failures become an ApiError.
instance.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config ?? {}
    const res = error.response

    // if (!config.skipAuth) {
    //     config._generation = generation
    //     const token = getToken()
    //     if (token) config.headers.set('Authorization', `Bearer ${token}`)
    //   }
    //   return config

    if (res?.status === 401 && !config.skipAuth) {
      config._attempts = (config._attempts ?? 0) + 1
      if (config._attempts <= 2) {
        // the token moved on while we were in flight — replay with the current one
        // instead of burning another rotation
        if (config._generation !== generation) return instance.request(config)
        if (await refreshOnce(config._generation)) return instance.request(config)
      }
    }

    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return Promise.reject(new ApiError(0, 'The API took too long to respond. Try again.'))
    }
    if (!res) {
      return Promise.reject(new ApiError(0, 'Cannot reach the API. Check the connection and try again.'))
    }

    // FastAPI returns {"detail": "..."} — 422 returns a list of field errors.
    const payload = res.data && typeof res.data === 'object' ? res.data : {}
    const detail = Array.isArray(payload.detail)
      ? payload.detail.map((d) => d.msg).join('; ')
      : payload.detail
    if (res.status === 401 && !config.skipAuth) onUnauthorized()
    return Promise.reject(new ApiError(res.status, detail || defaultMessage(res.status)))
  }
)

// axios drops null and undefined params but keeps '' as `?key=`; the API wants
// those absent entirely.
function cleanParams(params) {
  if (!params) return undefined
  const out = {}
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v
  }
  return out
}

async function request(
  path,
  { method = 'GET', body, params, headers, auth = true, timeout } = {}
) {
  // An expired access token is refreshed up front rather than after a wasted 401.
  if (auth && !getToken() && !(await refreshOnce())) {
    onUnauthorized()
    throw new ApiError(401, defaultMessage(401))
  }

  const res = await instance.request({
    url: path,
    method,
    data: body,
    params: cleanParams(params),
    skipAuth: !auth,
    ...(headers && { headers }),
    ...(timeout && { timeout })
  })

  if (res.status === 204) return null
  return res.data
}

export const api = {
  authenticate: (username, password) =>
    request('/authenticate', { method: 'POST', auth: false, body: { username, password } }),

  // NOTE: /refresh takes no body — the refresh token travels as the bearer
  // token, and the response is a brand new access/refresh pair.
  refresh: (refresh_token) =>
    request('/refresh', {
      method: 'POST',
      auth: false,
      headers: { Authorization: `Bearer ${refresh_token}` }
    }),

  semesters: () => request('/meta/semesters', { auth: false }),

  logout: () => request('/logout', { method: 'POST' }),

  getCommittees: () => request('/committees'),
  deleteCommittee: (comm_id, subcommittee) => request(`/committees/${comm_id}/${subcommittee}`, { method: 'DELETE' }),

  getCampusDegreePrograms: (campus_id, page = 1) => request(`/campus/${campus_id}/degrees`, { params: { page }}),
  getDegrees: ({ page = 1 }) => request('/degrees', { params: { page }}), // NOTE: this will be updated when the sort is handled
  addDegree: ({ campus_id, course_name, college = null, college_long = null }) =>
    request(`/campus/${campus_id}/degrees`, {
      method: 'POST',
      body: { campus_id, course_name, college, college_long },
    }),
  editDegree: (campus_id, degree_id, { campus_id: to_campus_id, course_name, college = null, college_long = null }) => request(
    `/campus/${campus_id}/degrees/${degree_id}`,
    {
      method: 'PATCH',
      body: { campus_id: to_campus_id ?? campus_id, course_name, college, college_long }
    }
  ),

  getReaffiliationsSummary: ({ year, semester = null, start_semester = null, end_semester = null}) => request(`/reaffiliations/summary`, { params: { year, semester, start_semester, end_semester }}),
  
  // Analytics aggregates server-side and regularly outruns the 5s default.
  fetchAnalysis: (query) => request('/analytics', { method: 'POST', body: query, timeout: 30000 }),

  getMembers: ({ year, sem, page = 1 }) => request('/members', { params: { year, sem, page } }),
  getSingleMemberHistory: ({ dssoc_id }) => request(`/members/history/${dssoc_id}`),
  editMember: (dssoc_id, member) => request(`/members/${dssoc_id}`, { method: 'PATCH', body: member }),
  deleteMember: (dssoc_id) => request(`/members/${dssoc_id}`, { method: "DELETE" }),

  getCampuses: () => request('/campus'),

  getReaffiliations: ({ year, sem, campus_id = null, comm_id = null, include_member_data = false, page = 1}) => 
    request('/reaffiliations', { params: { year, sem, campus_id, comm_id, include_member_data, page } }),
  deleteReaffiliation: ( id ) => request(`/reaffiliations/reaff/${id}`, { method: 'DELETE' }, ),

  addUser: (username, password) => request('/user/create', { method: 'POST', body: { username, password }}),
  getUsers: ({ page = 1 }) => request('/admin/users', { params: { page }}),

  getUserRoles: ({ page = 1 }) => request('/admin/user-roles', { params: { page }}),
  addUserRole: ({ role_name, description, permissions}) => request('/user-roles', { method: 'POST', body: { role_name, description, permissions }}),
  updateUserRole: (user_role_id, { role_name = null, description = null, permissions = null }) =>
    request('/user-roles', {
      method: 'PATCH',
      params: { user_role_id },
      body: { role_name, description, permissions },
    }),
  deleteUserRole: (user_role_id) =>
    request('/user-roles', { method: 'DELETE', params: { user_role_id } }),

  changePassword: ({ old_password, new_password }) => request('/recovery/change-password', { method: 'POST', body: { old_password, new_password }})
}

export const semesterCode = (year, semester) => `${year}${semester}`

// Latest = highest academic year, then B after A.
export function latestSemester(entries) {
  return [...entries].sort(
    (a, b) => b.year - a.year || b.semester.localeCompare(a.semester)
  )[0]
}