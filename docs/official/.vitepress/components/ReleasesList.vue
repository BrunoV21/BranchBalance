<script setup lang="ts">
import { computed } from 'vue'
import { withBase } from 'vitepress'

const startMarker = '<!-- release-notes:start -->'
const endMarker = '<!-- release-notes:end -->'

const releaseFiles = import.meta.glob('../../releases/v*.md', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

function frontmatterValue(source: string, key: string, fallback = '') {
  const match = source.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
  return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : fallback
}

function extractTag(file: string) {
  return file.split('/').pop()!.replace(/\.md$/, '')
}

function extractReleaseBody(source: string, file: string) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  if (start === -1 || end === -1 || end <= start) throw new Error(`${file} must contain release-notes start and end markers`)

  const body = source.slice(start + startMarker.length, end).trim()
  if (!body) throw new Error(`${file} must contain release notes between markers`)
  return body
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderInline(value: string) {
  const codeSpans: string[] = []
  let rendered = value.replace(/`([^`]+)`/g, (_, code) => {
    codeSpans.push(`<code>${escapeHtml(code)}</code>`)
    return `@@CODE${codeSpans.length - 1}@@`
  })

  rendered = escapeHtml(rendered)
  rendered = rendered.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`)
  return rendered.replace(/@@CODE(\d+)@@/g, (_, index) => codeSpans[Number(index)])
}

function renderMarkdown(source: string) {
  const lines = source.split('\n')
  const blocks: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }

    if (line.startsWith('```')) {
      const language = line.slice(3).trim()
      const code: string[] = []
      index += 1
      while (index < lines.length && !lines[index].startsWith('```')) {
        code.push(lines[index])
        index += 1
      }
      index += 1
      const languageClass = language ? ` class="language-${escapeHtml(language)}"` : ''
      blocks.push(`<pre><code${languageClass}>${escapeHtml(code.join('\n'))}</code></pre>`)
      continue
    }

    const heading = line.match(/^(#{2,6})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`)
      index += 1
      continue
    }

    if (/^-\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^-\s+/.test(lines[index])) {
        items.push(`<li>${renderInline(lines[index].replace(/^-\s+/, ''))}</li>`)
        index += 1
      }
      blocks.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length && lines[index].trim() && !lines[index].startsWith('```') && !/^(#{2,6})\s+/.test(lines[index]) && !/^-\s+/.test(lines[index])) {
      paragraph.push(lines[index])
      index += 1
    }
    blocks.push(`<p>${renderInline(paragraph.join(' '))}</p>`)
  }

  return blocks.join('\n')
}

function compareTagsDescending(left: string, right: string) {
  return right.localeCompare(left, undefined, { numeric: true, sensitivity: 'base' })
}

const releases = Object.entries(releaseFiles)
  .map(([file, source]) => {
    const tag = extractTag(file)
    return {
      tag,
      title: frontmatterValue(source, 'title', tag),
      description: frontmatterValue(source, 'description', `Release notes for ${tag}.`),
      date: frontmatterValue(source, 'date'),
      status: frontmatterValue(source, 'status', 'preview'),
      channel: frontmatterValue(source, 'channel', 'Android preview'),
      html: renderMarkdown(extractReleaseBody(source, file))
    }
  })
  .sort((left, right) => {
    const dateOrder = right.date.localeCompare(left.date)
    if (dateOrder) return dateOrder

    const statusOrder = Number(right.status === 'stable') - Number(left.status === 'stable')
    return statusOrder || compareTagsDescending(left.tag, right.tag)
  })

const latest = releases[0]
const stableReleases = computed(() => releases.filter((release) => release.status === 'stable'))
const latestIsStable = computed(() => latest?.status === 'stable')

function readableDate(value: string) {
  if (!value) return 'Date pending'
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
}
</script>

<template>
  <div v-if="latest" class="bb-releases">
    <section class="release-hero">
      <div class="shell release-hero-grid">
        <div><p class="eyebrow">Releases</p><h1 class="display-title">Built in public.<br>Released with care.</h1><p class="section-lede">Follow what is implemented, what still needs proving, and when BranchBalance is ready for everyday use.</p></div>
        <div class="release-channel"><span>Current channel</span><strong>{{ latest.channel }}</strong></div>
      </div>
    </section>

    <div class="shell release-layout">
      <article class="release-card">
        <header class="release-card-head">
          <div class="release-badges"><span class="status-pill"><span class="dot" />Latest {{ latest.status }}</span><span class="status-pill neutral">Updated {{ readableDate(latest.date) }}</span></div>
          <h1>{{ latest.title }}</h1>
          <p>{{ latest.description }}</p>
        </header>

        <div class="release-body">
          <h2>What is in this release</h2>
          <div class="highlight-grid">
            <section class="highlight"><div class="point-icon">▣</div><h3>GitHub-backed groups</h3><p>Device-flow sign-in, rotating credentials, private repositories, and collaborator invitations.</p></section>
            <section class="highlight"><div class="point-icon">▤</div><h3>Complete expense lifecycle</h3><p>Add, edit, and delete dated expenses with conflict detection and deterministic shares.</p></section>
            <section class="highlight"><div class="point-icon">▥</div><h3>Balances and settlements</h3><p>Per-person paid totals, net balances, and a concise deterministic settlement list.</p></section>
            <section class="highlight"><div class="point-icon">◷</div><h3>Spending intelligence</h3><p>Group budgets, category limits, payment methods, filters, trip dates, and daily guidance.</p></section>
          </div>
          <div class="release-notes" v-html="latest.html" />
        </div>
      </article>

      <aside class="release-aside" aria-label="Release summary">
        <section class="aside-card">
          <h2>Readiness</h2>
          <div class="status-list">
            <div class="status-row"><span>Phase 1 implementation</span><strong>Complete</strong></div>
            <div class="status-row"><span>Spending increment</span><strong>Complete</strong></div>
            <div class="status-row"><span>Physical-device acceptance</span><strong :class="{ pending: !latestIsStable }">{{ latestIsStable ? 'Complete' : 'Pending' }}</strong></div>
            <div class="status-row"><span>Stable Git tag</span><strong :class="{ pending: !latestIsStable }">{{ latestIsStable ? 'Published' : 'Not published' }}</strong></div>
          </div>
        </section>

        <section class="aside-card">
          <h2>Release history</h2>
          <div v-if="stableReleases.length" class="release-history-list">
            <a v-for="release in stableReleases" :key="release.tag" class="release-history-link" :href="withBase(`/releases/${release.tag}`)"><span>{{ release.title }}</span><small>{{ readableDate(release.date) }}</small></a>
          </div>
          <div v-else class="history-empty"><strong>No stable releases yet.</strong><br>The first tagged release will appear here after the Android acceptance loop passes.</div>
        </section>

        <section class="aside-card">
          <h2>Follow progress</h2>
          <div class="aside-actions">
            <a class="button button-primary button-small" href="https://github.com/BrunoV21/BranchBalance">View source on GitHub</a>
            <a class="button button-secondary button-small" :href="withBase('/releases/releasing')">Release process</a>
            <a class="button button-secondary button-small" :href="withBase('/documentation/')">Explore documentation</a>
            <a class="button button-secondary button-small" :href="withBase('/')">Back to product</a>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>
