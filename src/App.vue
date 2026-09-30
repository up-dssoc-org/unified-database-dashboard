<script setup>
import { computed, ref } from 'vue'
import { RouterLink, RouterView, useRouter } from 'vue-router'
import { auth } from './stores/auth'
import Toast from './components/generic/Toast.vue'

const router = useRouter()
const signingOut = ref(false)
const shell = computed(() => auth.isAuthenticated.value)

async function signOut() {
  signingOut.value = true
  await auth.logout()
  signingOut.value = false
  router.push({ name: 'login' })
}
</script>

<template>
  <div v-if="shell" class="layout">
    <aside class="rail">
      <div class="mark">
        <span class="mark-abbr">DSSoc</span>
        <span class="mark-name">Unified Database<br />Dashboard</span>
      </div>

      <nav>
        <RouterLink :to="{ name: 'summary' }">Semester summary</RouterLink>
        <RouterLink :to="{ name: 'reaffiliations' }">Reaffiliations</RouterLink>

        <div class="nav-section" :hidden="!auth?.isAdmin?.value">
          <p class="nav-heading">Admin</p>
          <span class="nav-disabled" aria-disabled="true">Dashboard</span>
          <!-- NOTE: ???? -->
          <!-- Might be good to have an individual table for activity as well hehe -->
          <span class="nav-disabled">Activity</span>
        </div>

        <div class="nav-section" :hidden="!auth?.isAdmin?.value">
          <p class="nav-heading">Manage</p>
          <RouterLink :to="{ name: 'manage-committees' }">Committees</RouterLink>
          <span class="nav-disabled" aria-disabled="true">Adhoc Committees</span>
          <RouterLink :to="{ name: 'manage-degrees' }">Degree Programs</RouterLink>
          <span class="nav-disabled">Reaffiliations</span>
          <RouterLink :to="{ name: 'manage-members' }">Members</RouterLink>
          <RouterLink :to="{ name: 'manage-user-roles' }">User Roles</RouterLink>
          <RouterLink :to="{ name: 'manage-users' }">Users</RouterLink>
        </div>
      </nav>

      <div class="account">
        <div class="account-card">
          <p class="who">{{ auth.username.value }}</p>
          <RouterLink :to="{ name: 'profile' }" class="profile-link">View profile →</RouterLink>
        </div>
        <button class="btn btn-quiet sign-out" :disabled="signingOut" @click="signOut">
          {{ signingOut ? 'Signing out…' : 'Sign out' }}
        </button>
      </div>
    </aside>

    <main class="content">
      <RouterView />

      <Toast />
    </main>
  </div>

  <RouterView v-else />
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: var(--rail) minmax(0, 1fr);
  min-height: 100%;
}

.rail {
  display: flex;
  flex-direction: column;
  gap: 2rem;
  padding: 1.6rem 1.1rem;
  background: var(--ink);
  color: #eceee9;
  border-right: 4px solid var(--maroon);
  position: sticky;
  top: 0;
  height: 100vh;
}

.mark {
  display: flex;
  gap: 0.7rem;
  align-items: flex-start;
}

.mark-abbr {
  font-family: var(--figure);
  font-weight: 500;
  font-size: 1.15rem;
  color: #fff;
  background: var(--maroon);
  padding: 0.1rem 0.4rem;
  border-radius: 2px;
}

.mark-name {
  font-size: 0.85rem;
  line-height: 1.3;
  color: #b9beb8;
}

nav {
  display: flex;
  flex-direction: column;
  flex: 1;
}

nav a {
  color: #c9ceca;
  text-decoration: none;
  padding: 0.55rem 0.6rem;
  border-left: 2px solid transparent;
  font-size: 0.93rem;
}

nav a:hover {
  color: #fff;
}

nav a.router-link-active {
  color: #fff;
  border-left-color: var(--maroon);
  background: #22262700;
  background: rgba(255, 255, 255, 0.06);
}

.nav-section {
  display: flex;
  flex-direction: column;
  margin-top: auto;
  padding-top: 0.9rem;
  border-top: 1px solid #2f3433;
}

.nav-section[hidden] {
  display: none;
}

.nav-heading {
  margin: 0 0 0.35rem;
  padding: 0 0.6rem;
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #7d8480;
}

.nav-disabled {
  color: #5a615e;
  padding: 0.55rem 0.6rem;
  border-left: 2px solid transparent;
  font-size: 0.93rem;
  cursor: not-allowed;
  user-select: none;
}

.account {
  border-top: 1px solid #2f3433;
  padding-top: 0.9rem;
}

.who {
  margin: 0;
  font-size: 0.9rem;
}

.account-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid #2f3433;
  border-radius: 2px;
  padding: 0.6rem 0.75rem;
  margin-bottom: 0.75rem;
}

.account-card .who {
  margin: 0 0 0.3rem;
}

.profile-link {
  font-size: 0.75rem;
  color: #9eb8a8;
  text-decoration: none;
}

.profile-link:hover {
  color: #fff;
  text-decoration: underline;
}

.unlinked {
  margin: 0;
  font-size: 0.75rem;
  color: #5a615e;
}

.sign-out {
  width: 100%;
  color: #eceee9;
  border-color: #3a403e;
}

.sign-out:hover:not(:disabled) {
  background: #262b2a;
  color: #fff;
  border-color: #5a615e;
}

.content {
  padding: 2rem 2.25rem 3rem;
  min-width: 0;
}

@media (max-width: 760px) {
  .layout {
    grid-template-columns: 1fr;
  }
  .rail {
    position: static;
    height: auto;
    flex-direction: row;
    align-items: center;
    gap: 1rem;
    border-right: 0;
    border-bottom: 3px solid var(--maroon);
    flex-wrap: wrap;
  }
  nav {
    flex-direction: row;
    flex: 1 1 100%;
  }
  nav a {
    border-left: 0;
    border-bottom: 2px solid transparent;
  }
  nav a.router-link-active {
    border-left: 0;
    border-bottom-color: var(--maroon);
  }
  .nav-section {
    flex-direction: row;
    align-items: center;
    margin-top: 0;
    margin-left: auto;
    padding-top: 0;
    border-top: 0;
  }
  .nav-heading {
    margin: 0;
  }
  .nav-disabled {
    border-left: 0;
  }
  .account {
    border-top: 0;
    padding-top: 0;
  }
  .content {
    padding: 1.25rem;
  }
}
</style>
