import { createApp } from 'vue'
import posthog from 'posthog-js'
import App from './App.vue'
import { router } from './router'
import { auth } from './stores/auth'
import { posthogLog } from './logging/posthog'
import './styles.css'

const posthogProjectToken = import.meta?.env?.VITE_POSTHOG_PROJECT_TOKEN
const posthogHost = import.meta?.env?.VITE_POSTHOG_HOST
const isPostHogConfigured = Boolean(
  import.meta?.env?.VITE_POSTHOG_PROJECT_TOKEN && import.meta?.env?.VITE_POSTHOG_HOST
)
const app = createApp(App)

if (posthogProjectToken && posthogHost) {
  posthog.init(posthogProjectToken, {
    api_host: posthogHost,
    defaults: '2026-01-30',
    logs: {
      serviceName: 'dssoc-membership-dashboard',
      environment: import.meta.env.MODE,
      serviceVersion: '0.1.0'
    }
  })

  app.config.errorHandler = (error) => {
    posthog.captureException(error)
  }

  auth.identifyCurrentUser()
  posthogLog.info('dashboard_application_started', {
    restored_authenticated_session: auth.isAuthenticated.value
  })
} else if (import.meta?.env?.DEV) {
  const missingVariable = posthogProjectToken
    ? 'VITE_POSTHOG_HOST'
    : 'VITE_POSTHOG_PROJECT_TOKEN'

  console.warn("POSTHOG_VARS disabled for the session")
}

app.provide('isPostHogConfigured', isPostHogConfigured)
app.use(router).mount('#app')