import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from './stores/auth'

const routes = [
  { path: '/', redirect: '/summary' },
  { path: '/login', name: 'login', component: () => import('./views/LoginView.vue') },
  {
    path: '/summary',
    name: 'summary',
    component: () => import('./views/SummaryView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/reaffiliations',
    name: 'reaffiliations',
    component: () => import('./views/ReaffiliationsView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: "/profile",
    name: "profile",
    component: () => import('./views/ProfileView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: "/analytics-dashboard",
    name: "analytics-dashboard",
    component: () => import('./views/AnalyticsDashboardView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: "/manage",
    children: [
      {
        path: "committees",
        name: "manage-committees",
        component: () => import('./views/manage/CommitteeView.vue')
      },
      {
        path: "degrees",
        name: "manage-degrees",
        component: () => import('./views/manage/DegreeProgramView.vue')
      },
      {
        path: "members",
        name: "manage-members",
        component: () => import('./views/manage/MembersView.vue')
      },
      {
        path: "user-roles",
        name: "manage-user-roles",
        component: () => import('./views/manage/UserRolesView.vue')
      },
      {
        path: "users",
        name: "manage-users",
        component: () => import('./views/manage/UsersView.vue')
      }
    ],
    meta: { requiresAuth: true, isAdmin: true }
  },
  { path: '/:pathMatch(.*)*', redirect: '/summary' }
]

export const router = createRouter({ history: createWebHistory(), routes })

router.beforeEach((to) => {
  const authStore = useAuthStore();
  if (to.meta.requiresAuth && !authStore.isAccessFresh()) {
    if (authStore.isRefreshTokenFresh()) return next()
    return { name: 'login', query: to.fullPath === '/summary' ? {} : { next: to.fullPath } }
  }
  if (to.meta.requiresMember && !authStore.isLinkedMember.value) {
    return { name: 'summary' }
  }
  if (to.name === 'login' && authStore.isAccessFresh()) return { name: 'summary' }
})
