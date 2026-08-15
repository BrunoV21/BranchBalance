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
const previousStableReleases = computed(() => stableReleases.value.filter((release) => release.tag !== latest?.tag))
const latestIsStable = computed(() => latest?.status === 'stable')
const installUrl = withBase('/install')

function primaryApkUrl(tag: string) {
  return `https://github.com/BrunoV21/BranchBalance/releases/download/${tag}/BranchBalance-${tag}-arm64-v8a.apk`
}

function readableDate(value: string) {
  if (!value) return 'Date pending'
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
}
</script>

<template>
  <div v-if="latest" class="bb-releases">
    <section class="release-hero release-hero-friendly">
      <div class="shell release-hero-grid">
        <div><p class="eyebrow">Current Android release</p><h1 class="display-title">A stable version, ready to install.</h1><p class="section-lede">{{ latest.title }} is the newest public BranchBalance download. Start the APK download here or use the guided install page if this is your first time.</p></div>
        <aside class="release-download-card">
          <span class="status-pill" :class="{ stable: latestIsStable }"><span class="dot" />{{ latest.status }}</span>
          <strong>BranchBalance {{ latest.tag }}</strong>
          <small>Android · most phones<br>Published {{ readableDate(latest.date) }}</small>
          <a class="button button-primary" :href="primaryApkUrl(latest.tag)" download>Download APK</a>
          <a class="text-link" :href="installUrl">Open the install guide instead</a>
        </aside>
      </div>
    </section>

    <div class="shell release-layout">
      <article class="release-card">
        <header class="release-card-head">
          <div class="release-badges"><span class="status-pill" :class="{ stable: latestIsStable }"><span class="dot" />Latest {{ latest.status }}</span><span class="status-pill neutral">{{ readableDate(latest.date) }}</span></div>
          <h1>What is new in {{ latest.tag }}</h1>
          <p>{{ latest.description }}</p>
        </header>

        <div class="release-body">
          <h2>Highlights</h2>
          <div class="highlight-grid">
            <section class="highlight"><div class="point-icon">▤</div><h3>Private receipt scanning</h3><p>Read receipt photos on your phone and review every detected detail before saving.</p></section>
            <section class="highlight"><div class="point-icon">✓</div><h3>You stay in control</h3><p>Choose the category, payment method, payer, and split instead of letting a scan decide.</p></section>
            <section class="highlight"><div class="point-icon">↺</div><h3>Easy to correct</h3><p>Edit uncertain values, retake the photo, or continue with manual entry at any time.</p></section>
            <section class="highlight"><div class="point-icon">▣</div><h3>Existing groups still work</h3><p>Your groups, expenses, payments, activity, and spending views remain compatible.</p></section>
          </div>
          <div class="release-notes" v-html="latest.html" />
        </div>
      </article>

      <aside class="release-aside" aria-label="Release summary">
        <section class="aside-card">
          <h2>At a glance</h2>
          <div class="status-list">
            <div class="status-row"><span>Version</span><strong>{{ latest.tag }}</strong></div>
            <div class="status-row"><span>Platform</span><strong>Android</strong></div>
            <div class="status-row"><span>Status</span><strong>{{ latestIsStable ? 'Stable' : 'Preview' }}</strong></div>
            <div class="status-row"><span>Download</span><strong>APK</strong></div>
          </div>
        </section>

        <section class="aside-card">
          <h2>Release history</h2>
          <div v-if="previousStableReleases.length" class="release-history-list">
            <a v-for="release in previousStableReleases" :key="release.tag" class="release-history-link" :href="withBase(`/releases/${release.tag}`)"><span>{{ release.title }}</span><small>{{ readableDate(release.date) }}</small></a>
          </div>
          <div v-else class="history-empty"><strong>No stable releases yet.</strong><br>The first tagged release will appear here after the Android acceptance loop passes.</div>
        </section>

        <section class="aside-card">
          <h2>Download help</h2>
          <p class="aside-copy">First time installing an APK, or using an older 32-bit phone? Start with the guided page.</p>
          <div class="aside-actions">
            <a class="button button-primary button-small" :href="installUrl">Open install guide</a>
            <a class="button button-secondary button-small" :href="withBase('/documentation/')">Help &amp; guides</a>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>
