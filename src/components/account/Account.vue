<script setup>
import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import ChangePassword from '@/components/account/ChangePassword.vue'

const username = computed(() => auth.username.value)
const permissions = computed(() => auth.permissions.value)
const auth = useAuthStore()
</script>

<template>
  <section class="panel account-section">
    <div class="section-header">
      <div>
        <h2>Account</h2>
        <p class="panel-note">System credentials and access level.</p>
      </div>
      <ChangePassword />
    </div>
    <dl class="fields">
      <div class="field-row">
        <dt>Username</dt>
        <dd class="figure">{{ username }}</dd>
      </div>
      <div class="field-row">
        <dt>Permissions</dt>
        <dd>
          <span v-if="permissions.length" class="perm-list">
            <span v-for="p in permissions" :key="p" class="perm-chip figure">{{ p }}</span>
          </span>
          <span v-else class="muted">No permissions assigned</span>
        </dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.account-section {
  display: flex;
  flex-direction: column;
}

.section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.25rem;
}

.section-header h2 {
  margin: 0;
}

.section-header .panel-note {
  margin: 0.15rem 0 0;
}

.fields {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.field-row {
  display: grid;
  grid-template-columns: 10rem 1fr;
  gap: 0.5rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--rule);
  align-items: baseline;
}

.field-row:last-child {
  border-bottom: none;
}

dt {
  font-size: 0.82rem;
  color: var(--slate);
}

dd {
  margin: 0;
  font-size: 0.9rem;
  word-break: break-word;
}

.perm-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.perm-chip {
  font-size: 0.72rem;
  padding: 0.1rem 0.45rem;
  background: var(--canvas);
  border: 1px solid var(--rule);
  border-radius: 2px;
  color: var(--ink);
}
</style>
