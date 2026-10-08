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

function refreshExpiry(res, fallback = null) {
  try {
    return claims(res.refresh_token).exp ?? fallback
  } catch {
    return fallback
  }
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
    exp: payload.exp,
    refreshExp: refreshExpiry(res, payload?.refresh_exp ?? null)
  }
}

const SESSION_KEY = 'dssoc.session'
const SESSION_REFRESH = 'dssoc.refresh'

// JWT exp is seconds since the epoch; every clock here is milliseconds.
const isFresh = (exp, now) => {
  return exp * 1000 > now
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    session: useSessionStorage(SESSION_KEY, null, { serializer: StorageSerializers.object }),
    refreshToken: useLocalStorage(SESSION_REFRESH, null),
    // NOTE: One second is granular enough to
    // drop the shell when the session lapses in an idle tab.
    currentTime: useTimestamp({ scheduler: (cb) => useIntervalFn(cb, 1000) }),
    isPostHogConfigured
  }),

  getters: {
    isAuthenticated: (state) =>
      isFresh(state.session?.exp, state.currentTime) ||
      (!!state.refreshToken && isFresh(state.session?.refreshExp, state.currentTime)),

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
      return isFresh(this.session?.exp, this.currentTime) // NOTE: is date.now() really the most efficient way
    },

    isRefreshTokenFresh() {
      return !!this.refreshToken && isFresh(this.session?.refreshExp, this.currentTime)
    },

    async login(username, password) {
      const res = await api.authenticate(username, password)
      this.session = sessionFrom(res)
      this.refreshToken = res.refresh_token ?? null
      this.identifyCurrentUser()
    },

    // Returns the new access token: the client's 401 retry reads a falsy result
    // as "refresh failed" and abandons the request.
    async refreshSession() {
      if (!this.refreshToken) return null
      try {
        const res = await api.refresh(this.refreshToken)
        if (!res?.access_token) return null
        this.session = sessionFrom(res)
        // /refresh rotates the pair, but keep the old one if none came back.
        this.refreshToken = res.refresh_token ?? this.refreshToken
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
