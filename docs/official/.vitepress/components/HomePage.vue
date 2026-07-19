<script setup lang="ts">
import { withBase } from 'vitepress'

const docsUrl = withBase('/documentation/')
const ownershipUrl = withBase('/documentation/data-ownership')
</script>

<template>
  <div class="bb-home">
    <section class="hero">
      <div class="shell hero-grid">
        <div>
          <p class="eyebrow">Open source · private by default</p>
          <h1 class="display-title">Shared<br>expenses.<br>Your data.</h1>
          <p class="hero-copy">Split trips, homes, and everyday life without handing your history to another opaque service. BranchBalance keeps every group in a private GitHub repository your group controls.</p>
          <div class="hero-actions">
            <a class="button button-primary" href="#how-it-works">
              See how it works
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </a>
            <a class="button button-secondary" :href="ownershipUrl">How your data works</a>
          </div>
          <a
            class="button button-download"
            href="https://github.com/BrunoV21/BranchBalance/releases/latest"
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg class="icon button-download-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 20h14" /></svg>
            <span class="button-download-copy"><strong>Download latest version</strong><small>Android APK · GitHub Releases</small></span>
            <svg class="icon button-download-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </a>
        </div>

        <div class="hero-art" aria-label="BranchBalance mobile spending and overview screens beside a private repository structure">
          <div class="hero-orbit" aria-hidden="true" />
          <div class="app-preview app-preview-secondary" aria-hidden="true">
            <div class="preview-screen">
              <div class="preview-status"><span>9:41</span><span>5G · ▰</span></div>
              <div class="preview-app-head"><span class="preview-back">‹</span><div><small>ROAD TRIP 2026</small><strong>Group overview</strong></div><span class="preview-action">↻</span></div>
              <div class="preview-content">
                <div class="preview-hero-card"><span class="preview-pill positive">● Synced</span><small>Your current balance</small><b class="preview-balance">+€84.20</b><span>You are owed across 7 expenses</span></div>
                <div class="preview-metrics"><div><small>Group spending</small><b>€412.60</b></div><div><small>You paid</small><b>€204.80</b></div></div>
                <div class="preview-label"><b>Trip budget</b><span>View spending</span></div>
                <div class="preview-budget"><b>€412.60 spent of €1,000</b><small>€587.40 remaining · 41% used</small><div class="preview-progress"><span /></div></div>
                <div class="preview-label"><b>Recent expenses</b><span>Filter</span></div>
                <div class="preview-expense"><span>16 JUL</span><b>Dinner at Nando’s</b><strong>€84.00</strong></div>
                <div class="preview-expense"><span>16 JUL</span><b>Petrol</b><strong>€68.50</strong></div>
              </div>
              <div class="preview-tabs"><span class="active">⌂<small>Overview</small></span><span>◷<small>Spending</small></span><span>▥<small>Balances</small></span><span>♙<small>Members</small></span></div>
            </div>
          </div>

          <div class="app-preview app-preview-primary" aria-hidden="true">
            <div class="preview-screen">
              <div class="preview-status"><span>9:41</span><span>5G · ▰</span></div>
              <div class="preview-app-head"><span class="preview-back">‹</span><div><small>ROAD TRIP 2026</small><strong>Spending</strong></div><span class="preview-action">⚙</span></div>
              <div class="preview-content">
                <div class="preview-budget-card">
                  <div class="preview-budget-head"><div><small>Trip budget</small><b>€412.60 <em>of €1,000</em></b><span>€587.40 remaining</span></div><span class="preview-pill positive">● Under budget</span></div>
                  <div class="preview-progress"><span /></div>
                  <div class="preview-budget-foot"><span>41% used</span><span>Day 4 of 7</span></div>
                  <div class="preview-period"><span>▣</span><div><small>Budget period</small><b>14 Jul → 20 Jul 2026</b></div></div>
                  <div class="preview-daily"><span>＋</span><div><b>€146.85</b><small>Available per remaining day</small></div></div>
                </div>
                <div class="preview-metrics three"><div><small>Group spent</small><b>€412.60</b></div><div><small>You paid</small><b>€204.80</b></div><div><small>Your share</small><b>€120.60</b></div></div>
                <div class="preview-label"><b>By category</b><span>Edit limits</span></div>
                <div class="preview-category"><span class="preview-category-icon">▤</span><div><b>Accommodation</b><small>38.8% of all spending</small><div class="preview-progress"><span style="width:53%" /></div></div><strong>€160.00</strong></div>
                <div class="preview-category over"><span class="preview-category-icon">♨</span><div><b>Food &amp; drinks</b><small>€16.10 over category limit</small><div class="preview-progress"><span style="width:100%" /></div></div><strong>€116.10</strong></div>
                <div class="preview-category"><span class="preview-category-icon">▰</span><div><b>Transport</b><small>16.6% of all spending</small><div class="preview-progress"><span style="width:34%" /></div></div><strong>€68.50</strong></div>
              </div>
              <div class="preview-tabs"><span>⌂<small>Overview</small></span><span class="active">◷<small>Spending</small></span><span>▥<small>Balances</small></span><span>♙<small>Members</small></span></div>
            </div>
          </div>

          <div class="repo-float">
            <div class="repo-head"><span class="status-dot" />branch-balance-road-trip</div>
            <div class="file-list" aria-hidden="true">
              <div class="file-row"><span>group.json</span><span>private</span></div>
              <div class="file-row"><span>expenses/dinner.json</span><span>JSON</span></div>
              <div class="file-row"><span>expenses/hotel.json</span><span>JSON</span></div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="trust-bar" aria-label="Product principles">
      <div class="shell trust-grid">
        <div class="trust-item"><div class="trust-value">Private by default</div><div class="trust-label">Every group is a private GitHub repository.</div></div>
        <div class="trust-item"><div class="trust-value">No app backend</div><div class="trust-label">The Android app talks directly to GitHub.</div></div>
        <div class="trust-item"><div class="trust-value">MIT open source</div><div class="trust-label">Read, audit, learn from, and improve the code.</div></div>
      </div>
    </section>

    <section class="section" id="ownership">
      <div class="shell ownership-grid">
        <div>
          <p class="eyebrow">Ownership you can point to</p>
          <h2 class="section-title">Your expense history has an address.</h2>
          <p class="section-lede">Not in a mystery database. Not behind an export request. It lives as readable files in the private repository created for your group.</p>
          <div class="ownership-points">
            <div class="ownership-point">
              <div class="point-icon"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11V7a7 7 0 0 1 14 0v4M4 11h16v10H4Z" /></svg></div>
              <div><h3>Private repository</h3><p>The creator owns the repository and invites trusted GitHub collaborators.</p></div>
            </div>
            <div class="ownership-point">
              <div class="point-icon"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 3-5 9 5 9M16 3l5 9-5 9M14 2l-4 20" /></svg></div>
              <div><h3>Portable, readable JSON</h3><p>Group settings and expenses use documented files, not a proprietary data format.</p></div>
            </div>
            <div class="ownership-point">
              <div class="point-icon"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="5" r="2" /><circle cx="18" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><path d="M6 7v10M8 5h4a6 6 0 0 1 6 6v6" /></svg></div>
              <div><h3>History included</h3><p>Git records how files change, while BranchBalance prevents silent conflict overwrites.</p></div>
            </div>
          </div>
        </div>

        <div class="architecture-card" role="img" aria-label="The BranchBalance Android app connects directly to a private GitHub repository. There is no BranchBalance server between them.">
          <div class="arch-label">Where your data goes</div>
          <div class="arch-flow">
            <div class="arch-node"><div class="point-icon"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M10 18h4" /></svg></div><strong>Your phone</strong><small>BranchBalance calculates balances and keeps credentials securely on-device.</small></div>
            <div class="arch-arrow"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M14 6l6 6-6 6" /></svg><span>GitHub API</span></div>
            <div class="arch-node"><div class="point-icon"><svg class="icon-fill" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2.2c-3.22.7-3.9-1.36-3.9-1.36-.52-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.72 1.27 3.39.97.1-.75.4-1.27.74-1.56-2.57-.29-5.27-1.29-5.27-5.72 0-1.27.45-2.3 1.2-3.11-.12-.3-.52-1.48.11-3.07 0 0 .98-.31 3.16 1.19a10.9 10.9 0 0 1 5.75 0c2.18-1.5 3.16-1.19 3.16-1.19.63 1.59.23 2.77.11 3.07.75.81 1.2 1.84 1.2 3.11 0 4.45-2.71 5.42-5.29 5.71.42.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" /></svg></div><strong>Your repository</strong><small>GitHub provides storage, identity, membership, and the source-of-truth history.</small></div>
          </div>
          <div class="no-server"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 5 14 14M4 9V4h5M20 15v5h-5" /></svg>No BranchBalance application server in the middle</div>
        </div>
      </div>
    </section>

    <section class="section section-rule" id="product">
      <div class="shell">
        <div class="section-heading">
          <div><p class="eyebrow">More than who owes whom</p><h2 class="section-title">A clear view of life together.</h2></div>
          <p class="section-lede">Use it for a weekend away, a shared flat, or the everyday costs that are easier when everyone can see the same picture.</p>
        </div>
        <div class="feature-grid">
          <article class="feature-card"><div class="feature-number">01 / Share fairly</div><h3>Add once. Balance instantly.</h3><p>Record who paid and who joined. BranchBalance allocates every cent deterministically and turns the result into a short settlement list.</p><div class="tag-row"><span class="tag">Equal splits</span><span class="tag">Full-to-one</span><span class="tag">Just me</span></div></article>
          <article class="feature-card"><div class="feature-number">02 / Spend intentionally</div><h3>See where the money went.</h3><p>Follow a group budget, optional category limits, card-or-cash totals, and daily guidance across a trip.</p><div class="tag-row"><span class="tag">Budgets</span><span class="tag">Categories</span><span class="tag">Trip pacing</span></div></article>
          <article class="feature-card"><div class="feature-number">03 / Stay in control</div><h3>Trust through visibility.</h3><p>Membership comes from GitHub collaborators, writes use explicit conflict checks, and your repository remains the authority.</p><div class="tag-row"><span class="tag">Private repo</span><span class="tag">Git history</span><span class="tag">Open source</span></div></article>
        </div>
      </div>
    </section>

    <section class="section section-rule" id="how-it-works">
      <div class="shell">
        <p class="eyebrow">Simple on the surface</p>
        <h2 class="section-title">From GitHub sign-in to settled.</h2>
        <div class="steps">
          <article class="step"><h3>Connect GitHub</h3><p>Authorize BranchBalance through GitHub’s device flow. Your rotating credentials stay in secure storage on your phone.</p></article>
          <article class="step"><h3>Create a private group</h3><p>Name the group, choose a currency, and invite collaborators. The new private repository becomes the shared space.</p></article>
          <article class="step"><h3>Track and understand</h3><p>Add expenses, follow the budget, and see balances update from the same repository-backed snapshot.</p></article>
        </div>
      </div>
    </section>

    <section class="section-tight" id="open-source">
      <div class="shell open-source-panel">
        <div>
          <p class="eyebrow">Built in the open</p>
          <h2>Don’t just take our word for it. Read the source.</h2>
          <p>BranchBalance is MIT licensed. Inspect how money is calculated, how GitHub access works, and how local credentials are handled—then open an issue or make it better.</p>
          <div class="hero-actions"><a class="button button-primary" href="https://github.com/BrunoV21/BranchBalance">View on GitHub</a><a class="button button-secondary" :href="docsUrl">Explore documentation</a></div>
        </div>
        <div class="license-seal" aria-label="MIT licensed open-source software"><div><strong>MIT</strong><span>Open source</span></div></div>
      </div>
    </section>
    <div class="bb-page-footer-space" />
  </div>
</template>
