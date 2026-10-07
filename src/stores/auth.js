import { defineStore } from 'pinia';
import { useNow, useStorage, useLocalStorage, useSessionStorage } from '@vueuse/core'
import { ref, reactive, computed } from 'vue'
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

const SESSION_KEY = 'dssoc.session';
const SESSION_REFRESH = 'dssoc.refresh';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    session: null,
    accessToken: null,
    refreshToken: null,
    isPostHogConfigured: isPostHogConfigured,
    currentTime: useNow()
  }),
  getters: {
    isAuthenticated: (state) => {
      if (!state?.session) return false
      const session = this.state?.session
      return this.isAccessFresh()
    },

    isLinkedMember: (state) => !!state?.session?.hasMemberId,

    isAdmin: (state) => {
      const held = state?.session?.permissions ?? []
      return held.includes('create:all')
    },

    isAccessFresh: (state) => {
      const session = state?.session
      if (!session) return false
      const expiry = state?.session?.exp
      return (!!session && expiry * 1000 > this.currentTime())
    },

    isRefreshTokenFresh: (state) => {
      const session = state?.session;
      if (!session) return false
      const refreshExpiry = state?.session?.refreshExp
      return (!!session && refreshExpiry * 1000 > this.currentTime())
    },

    // NOTE: tbh this is redundant af with is access fresh hahahaha why use it
    isSessionLive: (state) => {
      if (!state?.session) return false
      const until = s?.exp ?? null
      return typeof until === 'number' && until * 1000 > Date.now()
    },

    can: (state) => {
      const held = state?.session?.permissions ?? [];
      // TODO: check if you should include the include_all flag
      return needed.some((p) => held.includes(p)) // NOTE: this does not account for the
      // state where all permissions should be met
    }
  },
  // actions shouldn't be using arrow functions, getters are allowed
  actions: {
    // updateAuthToken() {
    
    // }

    load() {
      try {
        const raw = sessionStorage.getItem(SESSION_KEY)
        if (!raw) return null
        const session = JSON.parse(raw)
        return this.isSessionLive() ? session : null
      } catch {
        return null
      }
    },

    async login(username, password) {
      const res = await api.authenticate(username, password);
      const payload = claims(res?.access_token);
      this.state.session = {
        token: res?.access_token,
        refresh_token: res?.refresh_token,
        userId: typeof payload.sub === 'string' && payload.sub ? payload.sub : null,
        username: res.user?.username ?? payload.sub,
        member: res?.user?.member ?? null,
        hasMemberId: res?.user?.has_member_id ?? false,
        permissions: payload.permissions ?? [],
        exp: payload.exp,
        refreshExp: refreshExpiry(res, payload?.refresh_exp ?? null)
      };
      this.state.accessToken = res?.access_token;
      this.state.refreshToken = res?.refresh_token;

      useStorage(SESSION_KEY, this.state?.session);
      useStorage(SESSION_REFRESH, this.state?.refresh_token)
      identifyCurrentUser()
    },

    async refreshSession() {
      const refreshToken = this.state?.refreshToken
      if (!refreshToken) return null

      const res = await api.refresh(refreshToken)
      if (!res?.access_token) return null
      const payload = claims(res.access_token)
      state.session = {
        token: res?.access_token,
        refresh_token: res?.refresh_token,
        userId: typeof payload.sub === 'string' && payload.sub ? payload.sub : null,
        username: res.user?.username ?? payload.sub,
        member: res?.user?.member ?? null,
        hasMemberId: res?.user?.has_member_id ?? false,
        permissions: payload.permissions ?? [],
        exp: payload.exp,
        refreshExp: refreshExpiry(res, payload?.refresh_exp ?? null)
      };
      state.accessToken = res?.access_token;
      state.refreshToken = res?.refresh_token;

      useStorage(SESSION_REFRESH, this.state?.refresh_token)
      identifyCurrentUser()
    },

    identifyCurrentUser() {
      const session = state?.session
      if (!isPostHogConfigured || !session?.userId) return

      posthog.identify(session?.userId, { username: session?.username })
    },

    updateSessionMember(updatedMember) {
      if (!this.state?.session) return
      this.state.session.member = updatedMember
        ? { ...(this.state.session.member ?? {}), ...updatedMember }
        : this.state.session.member
      useStorage(SESSION_KEY, JSON.stringify(this.state.session), sessionStorage)
    },

    async logout() {
      try {
        if (this.state?.session) await api.logout()
      } catch {
        // The token is discarded locally regardless of what the server says.
      } finally {
        clear()
      }
    },

    clear() {
      this.state.session = null
      useStorage(SESSION_KEY, null)
      useStorage(SESSION_REFRESH, null)
    }
  }
})