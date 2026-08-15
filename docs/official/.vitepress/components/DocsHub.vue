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
    title: 'Start here',
    detail: 'From download to your first private group.',
    icon: '✓',
    guides: [
      { title: 'Install BranchBalance on Android', detail: 'Direct download, Android safety messages, and first launch.', link: '/install' },
      { title: 'Sign in for the first time', detail: 'Why BranchBalance uses GitHub and what you will be asked to approve.', link: '/getting-started/' },
      { title: 'Create or join a group', detail: 'Choose Trip or Fuel, start a group, or accept an invitation.', link: '/guides/groups' }
    ]
  },
  {
    title: 'Using BranchBalance',
    detail: 'Everyday tasks for everyone in the group.',
    icon: '♙',
    guides: [
      { title: 'Add and split an expense', detail: 'Record who paid, who shared the cost, and whether it was personal.', link: '/guides/expenses' },
      { title: 'Understand group spending', detail: 'Budgets, categories, trip dates, fuel limits, and daily guidance.', link: '/guides/spending' },
      { title: 'Settle what people owe', detail: 'Suggested payments, sent money, confirmation, and history.', link: '/guides/settlements' }
    ]
  },
  {
    title: 'Privacy & access',
    detail: 'Plain-language answers about your group and its data.',
    icon: '▣',
    guides: [
      { title: 'Where your expenses are stored', detail: 'What is shared, what stays on your phone, and who can see it.', link: '/documentation/data-ownership' },
      { title: 'Owners, members, and invitations', detail: 'Who controls a group and what invited members can do.', link: '/documentation/permissions' },
      { title: 'What “private” means', detail: 'The protection BranchBalance provides and the limits you should know.', link: '/documentation/data-ownership#what-the-ownership-promise-does-and-does-not-mean' }
    ]
  },
  {
    title: 'For developers',
    detail: 'Source code, local setup, architecture, and testing.',
    icon: '⟨/⟩',
    guides: [
      { title: 'Run the app from source', detail: 'Node.js, npm, Expo, local configuration, and Android development.', link: '/reference/development' },
      { title: 'Architecture guide', detail: 'System boundaries, storage, GitHub operations, and compatibility.', link: '/reference/architecture' },
      { title: 'Testing and validation', detail: 'Automated checks and physical-device acceptance scenarios.', link: '/reference/testing' }
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
          <p class="eyebrow">Help &amp; guides</p>
          <h1 class="display-title">Find the next step, without the jargon.</h1>
          <p class="section-lede">Install BranchBalance, join your first group, and learn the everyday features. Technical build documentation has its own clearly marked section.</p>
          <div class="search-wrap">
            <svg class="icon search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
            <label class="sr-only" for="docs-hub-search">Search help and guides</label>
            <input id="docs-hub-search" v-model="query" class="doc-search" type="search" placeholder="Search installation, invitations, expenses…" autocomplete="off">
            <span class="search-key" aria-hidden="true">{{ resultCount }}</span>
          </div>
        </div>
        <aside class="quick-start-card">
          <div class="point-icon"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 20h14" /></svg></div>
          <strong>New to BranchBalance?</strong>
          <span>Start with the guided Android download. It explains every warning and sign-in step.</span>
          <a class="button button-primary button-small" :href="guideHref('/install')">Install on Android</a>
        </aside>
      </div>
    </section>

    <section class="docs-section">
      <div class="shell">
        <div class="docs-status" aria-live="polite">{{ query ? `${resultCount} ${resultCount === 1 ? 'guide' : 'guides'} found for “${query}”` : 'Browse 12 guides across four topics.' }}</div>
        <div v-if="filteredGroups.length" class="docs-grid">
          <section v-for="group in filteredGroups" :id="group.title === 'For developers' ? 'developers' : undefined" :key="group.title" class="docs-group" :class="{ 'developer-group': group.title === 'For developers' }">
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
        <div v-else class="search-empty is-visible">No guide matches that search yet. Try “install”, “invitation”, “expense”, or “privacy”.</div>
      </div>
    </section>

    <section class="section-tight section-rule">
      <div class="shell help-panel">
        <div><p class="eyebrow">Recommended first step</p><h2>Not sure where to begin?</h2><p>Use the guided Android install page. It includes direct app downloads, safety prompts, GitHub sign-in, and separate directions for creators and invited members.</p></div>
        <a class="button button-primary" :href="guideHref('/install')">Install BranchBalance</a>
      </div>
    </section>
    <div class="bb-page-footer-space" />
  </div>
</template>
