import posthog from 'posthog-js'

const isPostHogConfigured = Boolean(
  import.meta.env.VITE_POSTHOG_PROJECT_TOKEN && import.meta.env.VITE_POSTHOG_HOST
)

export const posthogLog = {
  info(message, attributes) {
    if (isPostHogConfigured) posthog.logger.info(message, attributes)
  },
  warn(message, attributes) {
    if (isPostHogConfigured) posthog.logger.warn(message, attributes)
  }
}
