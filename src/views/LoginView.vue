<script setup>
import { inject, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { posthogLog } from '../logging/posthog'
import posthog from 'posthog-js'

const isPostHogConfigured = inject('isPostHogConfigured')

const route = useRoute()
const router = useRouter()

const auth = useAuthStore();
const username = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
  error.value = ''
  busy.value = true
  try {
    await auth.login(username.value.trim(), password.value)
    if (isPostHogConfigured) {
      posthog.capture('user_logged_in')
      posthogLog.info('authentication_succeeded')
    }
    router.push(route.query.next || { name: 'summary' })
  } catch (e) {
    if (isPostHogConfigured) {
      posthogLog.warn('authentication_failed')
    }
    error.value = e?.detail || 'Sign-in failed. Try again.'
    console.error(e)
    password.value = ''
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="gate">
    <div class="plate">
      <span class="mark-abbr">DS</span>
      <h1>Membership database</h1>
      <p class="lede">
        Internal analytics for UP Data Science Society reaffiliations. Sign in with your
        unified database account.
      </p>

      <form @submit.prevent="submit">
        <div class="field">
          <label for="username">Username</label>
          <input id="username" v-model="username" autocomplete="username" required autofocus />
        </div>

        <div class="field">
          <label for="password">Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
          />
        </div>

        <p v-if="error" class="notice" role="alert">{{ error }}</p>

        <button class="btn" type="submit" :disabled="busy || !username || !password">
          {{ busy ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>

      <!-- <p class="fine">Sessions last 15 minutes and end when this tab closes.</p> -->
    </div>
  </div>
</template>

<style scoped>
.gate {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 1.5rem;
  background:
    linear-gradient(var(--canvas), var(--canvas)) padding-box,
    var(--canvas);
}

.plate {
  width: min(24rem, 100%);
  background: var(--surface);
  border: 1px solid var(--rule);
  border-top: 4px solid var(--maroon);
  border-radius: 2px;
  padding: 2rem 1.9rem;
}

.mark-abbr {
  display: inline-block;
  font-family: var(--figure);
  font-size: 1.1rem;
  color: #fff;
  background: var(--maroon);
  padding: 0.1rem 0.4rem;
  border-radius: 2px;
  margin-bottom: 1rem;
}

.lede {
  margin: 0.5rem 0 1.6rem;
  color: var(--slate);
  font-size: 0.9rem;
}

.field {
  margin-bottom: 1rem;
}

.notice {
  margin: 0 0 1rem;
}

.btn {
  width: 100%;
}

.fine {
  margin: 1.4rem 0 0;
  font-size: 0.78rem;
  color: var(--slate);
}
</style>
