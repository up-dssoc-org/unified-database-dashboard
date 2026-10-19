import { defineStore } from 'pinia'
import { StorageSerializers, useIntervalFn, useSessionStorage, useLocalStorage, useTimestamp, useNow } from '@vueuse/core'
import posthog from 'posthog-js'
import { api, configureAuth } from '../api/client'

const isPostHogConfigured = Boolean(
  import.meta?.env?.VITE_POSTHOG_PROJECT_TOKEN && import.meta?.env?.VITE_POSTHOG_HOST
)

function claims(token) {
  const [, payload] = token.split('.')
  return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
}

function claimsOrNull(token) {
  try {
    return claims(token)
  } catch {
    return null
  }
}

function refreshExpiry(res) {
  return claimsOrNull(res.refresh_token)?.exp ?? claimsOrNull(res.access_token)?.refresh_exp ?? null
}

// Login and refresh return the same payload shape, so the session is built in
// one place — otherwise the two copies drift.
function sessionFrom(res) {
  const payload = claims(res.access_token)
  return {
    token: res.access_token,
    userId: typeof payload.sub === 'string' && payload.sub ? payload.sub : null,
    username: res.user?.username ?? payload.sub,
    member: res.user?.member ?? null,
    hasMemberId: res.user?.has_member_id ?? false,
    permissions: payload.permissions ?? [],
    exp: payload.exp
  }
}

const SESSION_KEY = 'dssoc.session'
const SESSION_REFRESH = 'dssoc.refresh'
const SESSION_REFRESH_EXP = 'dssoc.refresh.exp'

// JWT exp is seconds since the epoch; every clock here is milliseconds. Storage
// hands the value back as a string, so coerce first — a missing expiry lands on
// NaN or 0 and reads as stale either way.
const isFresh = (exp, now) => {
  return Number(exp) * 1000 > now
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    session: useSessionStorage(SESSION_KEY, null, { serializer: StorageSerializers.object }),
    refreshToken: useLocalStorage(SESSION_REFRESH, null),
    refreshExp: useLocalStorage(SESSION_REFRESH_EXP, null),
    // NOTE: One second is granular enough to
    // drop the shell when the session lapses in an idle tab.
    currentTime: useTimestamp({ scheduler: (cb) => useIntervalFn(cb, 1000) }),
    isPostHogConfigured
  }),

  getters: {
    isAuthenticated: (state) =>
      isFresh(state.session?.exp, state.currentTime) ||
      (!!state.refreshToken && isFresh(state.refreshExp, state.currentTime)),

    isLinkedMember: (state) => !!state.session?.hasMemberId,

    // NOTE: this currently applies to editor/admin roles in the backend
    isAdmin: (state) => (state.session?.permissions ?? []).includes('create:all'),

    username: (state) => state.session?.username ?? '',
    permissions: (state) => state.session?.permissions ?? [],
    member: (state) => state.session?.member ?? null,

    // A getter that returns a function, so the views keep calling
    // auth.can('read:all', 'read:member'). OR logic — any one listed grants
    // access. Reads state when invoked, so it tracks inside the caller's
    // computed.
    can: (state) => (...needed) => {
      const held = state.session?.permissions ?? []
      return needed.some((p) => held.includes(p))
    }
  },

  // Arrow functions would lose `this`; actions need the store as the receiver.
  actions: {
    // Actions rather than getters: a navigation decision must not read a value
    // cached before the token expired, so these sample the clock on every call.
    isAccessFresh() {
      return isFresh(this.session?.exp, this.currentTime)
    },

    isRefreshTokenFresh() {
      return !!this.refreshToken && isFresh(this.refreshExp, this.currentTime)
    },

    async login(username, password) {
      const res = await api.authenticate(username, password)
      this.session = sessionFrom(res)
      this.refreshToken = null
      this.refreshExp = null
      this.rememberRefresh(res)
      this.identifyCurrentUser()
    },

    rememberRefresh(res) {
      if (!res?.refresh_token) return
      this.refreshToken = res.refresh_token
      this.refreshExp = refreshExpiry(res)
    },

    async refreshSession() {
      if (!this.refreshToken) return null
      try {
        const res = await api.refresh(this.refreshToken)
        if (!res?.access_token) return null
        this.session = sessionFrom(res)
        this.rememberRefresh(res)
        this.identifyCurrentUser()
        return this.session.token
      } catch {
        // NOTE this clear does not
        this.clear()
        return null
      }
    },

    identifyCurrentUser() {
      if (!this.isPostHogConfigured || !this.session?.userId) return
      posthog.identify(this.session.userId, { username: this.session.username })
    },

    updateMember(updatedMember) {
      if (!this.session || !updatedMember) return
      this.session = {
        ...this.session,
        member: { ...(this.session.member ?? {}), ...updatedMember }
      }
    },

    async logout() {
      try {
        if (this.session) await api.logout()
      } catch {
        // The token is discarded locally regardless of what the server says.
      } finally {
        this.clear()
      }
    },

    clear() {
      this.session = null
      this.refreshToken = null
      this.refreshExp = null
    }
  }
})

// client.js stays free of store imports. These closures run at module load but
// defer useAuthStore() to the first request, by which point app.use(pinia) has
// installed the active pinia.
configureAuth({
  tokenGetter: () => {
    const auth = useAuthStore()
    return auth.isAccessFresh() ? auth.session.token : null
  },
  unauthorizedHandler: () => useAuthStore().clear(),
  sessionRefresher: () => useAuthStore().refreshSession()
})
