<script setup lang="ts">
import { computed, ref } from 'vue'
import { withBase } from 'vitepress'

interface Guide {
  title: string
  detail: string
  link: string
}

interface GuideGroup {
  title: string
  detail: string
  icon: string
  guides: Guide[]
}

const query = ref('')

const groups: GuideGroup[] = [
  {
    title: 'Getting started',
    detail: 'From source checkout to your first private group.',
    icon: '✓',
    guides: [
      { title: 'Install and run the preview', detail: 'Requirements, npm setup, Expo, and local development.', link: '/getting-started/' },
      { title: 'Configure the GitHub App', detail: 'Device flow, permissions, installation coverage, and secrets.', link: '/getting-started/github-app' },
      { title: 'Connect an Android device', detail: 'Run Metro through USB when the phone cannot reach your Mac.', link: '/getting-started/android-usb' }
    ]
  },
  {
    title: 'Using BranchBalance',
    detail: 'Common workflows for owners and group members.',
    icon: '♙',
    guides: [
      { title: 'Create and invite a group', detail: 'Private repositories, currencies, collaborators, and invitations.', link: '/guides/groups' },
      { title: 'Add and split expenses', detail: 'Equal, full-to-one, and Just me expenses explained.', link: '/guides/expenses' },
      { title: 'Plan and understand spending', detail: 'Budgets, trip dates, categories, methods, and filters.', link: '/guides/spending' }
    ]
  },
  {
    title: 'Data & ownership',
    detail: 'Plain-language answers about trust and control.',
    icon: '▣',
    guides: [
      { title: 'How BranchBalance stores your data', detail: 'What lives on GitHub, what stays on-device, and who can see it.', link: '/documentation/data-ownership' },
      { title: 'Membership and permissions', detail: 'Owners, accepted collaborators, pending invites, and access.', link: '/documentation/permissions' },
      { title: 'Credential security', detail: 'Rotating GitHub tokens, SecureStore, and safe configuration.', link: '/documentation/security' }
    ]
  },
  {
    title: 'Build & contribute',
    detail: 'The product and engineering decisions behind the app.',
    icon: '⟨/⟩',
    guides: [
      { title: 'Architecture guide', detail: 'Boundaries, state, GitHub operations, storage, and compatibility.', link: '/reference/architecture' },
      { title: 'Testing guide', detail: 'Automated checks and physical-device acceptance scenarios.', link: '/reference/testing' },
      { title: 'Product requirements', detail: 'Phase 1, spending intelligence, constraints, and acceptance.', link: '/reference/PRD' }
    ]
  }
]

const filteredGroups = computed(() => {
  const normalized = query.value.trim().toLocaleLowerCase()
  if (!normalized) return groups

  return groups
    .map((group) => ({
      ...group,
      guides: group.guides.filter((guide) => `${group.title} ${guide.title} ${guide.detail}`.toLocaleLowerCase().includes(normalized))
    }))
    .filter((group) => group.guides.length > 0)
})

const resultCount = computed(() => filteredGroups.value.reduce((total, group) => total + group.guides.length, 0))
const guideHref = (link: string) => withBase(link)
</script>

<template>
  <div class="bb-docs-hub">
    <section class="page-hero">
      <div class="shell page-hero-grid">
        <div>
          <p class="eyebrow">Documentation</p>
          <h1 class="display-title">Know what happens to every cent.</h1>
          <p class="section-lede">Start using BranchBalance, understand the GitHub-backed model, or explore the decisions behind the open-source app.</p>
          <div class="search-wrap">
            <svg class="icon search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
            <label class="sr-only" for="docs-hub-search">Filter documentation guides</label>
            <input id="docs-hub-search" v-model="query" class="doc-search" type="search" placeholder="Filter guides, concepts, and workflows…" autocomplete="off">
            <span class="search-key" aria-hidden="true">{{ resultCount }}</span>
          </div>
        </div>
        <aside class="preview-note"><strong>Preview documentation</strong>The Android build is still awaiting physical-device acceptance. These guides describe the current implemented product.</aside>
      </div>
    </section>

    <section class="docs-section">
      <div class="shell">
        <div class="docs-status" aria-live="polite">{{ query ? `${resultCount} ${resultCount === 1 ? 'guide' : 'guides'} found for “${query}”` : 'Browse 12 guides across four topics.' }}</div>
        <div v-if="filteredGroups.length" class="docs-grid">
          <section v-for="group in filteredGroups" :key="group.title" class="docs-group">
            <div class="docs-group-head">
              <div class="point-icon" aria-hidden="true">{{ group.icon }}</div>
              <div><h2>{{ group.title }}</h2><p>{{ group.detail }}</p></div>
            </div>
            <div class="doc-list">
              <a v-for="guide in group.guides" :key="guide.link" class="doc-entry" :href="guideHref(guide.link)">
                <span><strong>{{ guide.title }}</strong><small>{{ guide.detail }}</small></span>
                <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </a>
            </div>
          </section>
        </div>
        <div v-else class="search-empty is-visible">No guide matches that search yet. Try “GitHub”, “expense”, “budget”, or “testing”.</div>
      </div>
    </section>

    <section class="section-tight section-rule">
      <div class="shell open-source-panel">
        <div>
          <p class="eyebrow">Documentation is part of the product</p>
          <h2>See a gap? Improve it in the open.</h2>
          <p>The PRD, architecture guide, tests, and implementation live together in the repository so product promises can be checked against the code.</p>
          <div class="hero-actions"><a class="button button-primary" href="https://github.com/BrunoV21/BranchBalance">Browse the repository</a><a class="button button-secondary" :href="guideHref('/releases/')">View release status</a></div>
        </div>
        <div class="license-seal" aria-label="Documentation backed by source"><div><strong>{ }</strong><span>Source first</span></div></div>
      </div>
    </section>
    <div class="bb-page-footer-space" />
  </div>
</template>
