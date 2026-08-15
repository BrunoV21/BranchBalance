<script setup lang="ts">
import { withBase } from 'vitepress'

const docsUrl = withBase('/documentation/')
const ownershipUrl = withBase('/documentation/data-ownership')
const installUrl = withBase('/install')
const primaryApkUrl = 'https://github.com/BrunoV21/BranchBalance/releases/download/v1.2.0/BranchBalance-v1.2.0-arm64-v8a.apk'
const groupTypeRequestUrl = 'https://github.com/BrunoV21/BranchBalance/issues/new?template=group_type_request.yml'
</script>

<template>
  <div class="bb-home">
    <section class="hero">
      <div class="shell hero-grid">
        <div>
          <p class="eyebrow">Private shared expenses for Android</p>
          <h1 class="display-title">Split costs.<br>Stay even.<br>Keep control.</h1>
          <p class="hero-copy">Track trips, fuel, and shared costs without the awkward maths. Everyone sees who paid, who owes, and how the group is spending.</p>
          <div class="hero-actions">
            <a class="button button-primary" :href="installUrl">
              Install on Android
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 20h14" /></svg>
            </a>
            <a class="button button-secondary" href="#how-it-works">See how it works</a>
          </div>
          <div class="hero-facts" aria-label="Important requirements">
            <span>Android only</span><span>Free GitHub account required</span><span>Version 1.2.0</span>
          </div>
          <a class="direct-download-link" :href="primaryApkUrl" download>Already know how? Download the APK for most phones</a>
        </div>

        <div class="hero-art" aria-label="BranchBalance mobile overview and spending screens with a private-group message">
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

          <div class="repo-float privacy-float">
            <div class="repo-head"><span class="status-dot" />Road trip 2026</div>
            <div class="privacy-float-body">
              <strong>Private group</strong>
              <span>Only Alex, Maya, Jo and Sam can see these expenses.</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="trust-bar" aria-label="Product principles">
      <div class="shell trust-grid">
        <div class="trust-item"><div class="trust-value">Easy to start</div><div class="trust-label">Install the app, then create or join a group.</div></div>
        <div class="trust-item"><div class="trust-value">Private groups</div><div class="trust-label">Only the people you invite can see the expenses.</div></div>
        <div class="trust-item"><div class="trust-value">No ads or tracking</div><div class="trust-label">Your spending history is not marketing data.</div></div>
      </div>
    </section>

    <section class="section" id="product">
      <div class="shell">
        <div class="section-heading">
          <div><p class="eyebrow">Made for real life</p><h2 class="section-title">Less money admin. More clarity.</h2></div>
          <p class="section-lede">Use BranchBalance for a holiday with friends, a weekend away, or recurring fuel costs that are easier when everyone sees the same picture.</p>
        </div>
        <div class="feature-grid">
          <article class="feature-card"><div class="feature-number">01 / Share fairly</div><h3>Add it once. Split it clearly.</h3><p>Choose who paid and who shared the cost. BranchBalance handles the cents and keeps everyone’s balance up to date.</p><div class="tag-row"><span class="tag">Equal split</span><span class="tag">One person</span><span class="tag">Personal cost</span></div></article>
          <article class="feature-card"><div class="feature-number">02 / Understand spending</div><h3>See where the money went.</h3><p>Follow the group budget, understand categories, and see what is still available for the rest of a trip.</p><div class="tag-row"><span class="tag">Budgets</span><span class="tag">Categories</span><span class="tag">Daily guidance</span></div></article>
          <article class="feature-card"><div class="feature-number">03 / Settle simply</div><h3>Know exactly who owes whom.</h3><p>See a short list of suggested payments, record money sent outside the app, and confirm when it arrives.</p><div class="tag-row"><span class="tag">Clear balances</span><span class="tag">Fewer payments</span><span class="tag">Payment history</span></div></article>
        </div>
      </div>
    </section>

    <section class="section section-rule" id="group-types">
      <div class="shell">
        <div class="section-heading group-types-heading">
          <div><p class="eyebrow">Groups made for what you share</p><h2 class="section-title">Split costs with tools that fit.</h2></div>
          <p class="section-lede">Every group includes clear expense splitting. Choose a group type to get planning and spending insights suited to what you are doing.</p>
        </div>
        <div class="group-type-grid">
          <article class="group-type-card">
            <div class="group-type-card-head"><div class="group-type-icon"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M4 7h16v13H4ZM4 12h16M10 12v2h4v-2" /></svg></div><span class="group-type-status">Available now</span></div>
            <h3>Trips &amp; travel</h3><p>Share travel costs across a dated trip, with a total budget and simple daily spending guidance.</p>
          </article>
          <article class="group-type-card">
            <div class="group-type-card-head"><div class="group-type-icon"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M4 10h12M7 6h6M16 7h2l2 3v7a2 2 0 0 1-4 0v-3" /></svg></div><span class="group-type-status">Available now</span></div>
            <h3>Fuel</h3><p>Share fuel purchases, set a monthly spending limit, and understand litres, prices, and savings.</p>
          </article>
          <article class="group-type-card group-type-request">
            <div class="group-type-card-head"><div class="group-type-icon"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 22h4M8.5 14.5A7 7 0 1 1 15.5 14.5C14.5 15.3 14 16.2 14 18h-4c0-1.8-.5-2.7-1.5-3.5Z" /></svg></div><span class="group-type-status group-type-status-idea">Your idea</span></div>
            <h3>Need another group type?</h3><p>Tell us what you want to split and track. Your idea could help shape the next group type.</p>
            <a class="button button-secondary group-type-request-button" :href="groupTypeRequestUrl" target="_blank" rel="noopener noreferrer">Send a feature request</a>
            <small>This opens a public GitHub form and may ask you to sign in. Do not include private spending details.</small>
          </article>
        </div>
      </div>
    </section>

    <section class="section section-rule" id="how-it-works">
      <div class="shell">
        <p class="eyebrow">Getting started</p>
        <h2 class="section-title">From download to your first shared expense.</h2>
        <div class="steps steps-four">
          <article class="step"><h3>Install the Android app</h3><p>Download BranchBalance directly from this website and follow the short Android installation guide.</p></article>
          <article class="step"><h3>Sign in securely</h3><p>Continue to GitHub with an existing account or create a free one. BranchBalance explains the requested access first.</p></article>
          <article class="step"><h3>Create or join</h3><p>Start a private group and invite people you know, or accept an invitation to an existing group.</p></article>
          <article class="step"><h3>Add and settle</h3><p>Record expenses as they happen. Everyone sees updated spending and a clear list of balances.</p></article>
        </div>
        <div class="centered-action"><a class="button button-primary" :href="installUrl">Start with the install guide</a></div>
      </div>
    </section>

    <section class="section section-rule" id="ownership">
      <div class="shell ownership-grid">
        <div>
          <p class="eyebrow">Private without the mystery</p>
          <h2 class="section-title">Your group controls its history.</h2>
          <p class="section-lede">BranchBalance uses a private space in GitHub for your group. That means the creator controls access, the data can be exported, and BranchBalance does not keep a second copy on its own server.</p>
          <div class="ownership-points">
            <div class="ownership-point"><div class="point-icon"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11V7a7 7 0 0 1 14 0v4M4 11h16v10H4Z" /></svg></div><div><h3>Only invited people</h3><p>The group creator chooses who can open and change the shared expenses.</p></div></div>
            <div class="ownership-point"><div class="point-icon"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 20h14" /></svg></div><div><h3>Exportable history</h3><p>Your records are readable and can be downloaded instead of being trapped inside the app.</p></div></div>
            <div class="ownership-point"><div class="point-icon"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM4 9h16M8 13h3M8 16h6" /></svg></div><div><h3>No advertising profile</h3><p>BranchBalance does not use group spending to serve ads or build a marketing profile.</p></div></div>
          </div>
          <a class="text-link ownership-link" :href="ownershipUrl">Read the detailed data and privacy explanation</a>
        </div>
        <div class="architecture-card" role="img" aria-label="Your phone connects securely to a private group space. BranchBalance does not keep a separate server copy.">
          <div class="arch-label">Where your shared expenses go</div>
          <div class="arch-flow">
            <div class="arch-node"><div class="point-icon"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M10 18h4" /></svg></div><strong>Your phone</strong><small>You add expenses and BranchBalance calculates the balances.</small></div>
            <div class="arch-arrow"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M14 6l6 6-6 6" /></svg><span>Secure connection</span></div>
            <div class="arch-node"><div class="point-icon"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11V7a7 7 0 0 1 14 0v4M4 11h16v10H4Z" /></svg></div><strong>Your private group</strong><small>GitHub stores the shared history and controls who can access it.</small></div>
          </div>
          <div class="no-server"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 5 14 14M4 9V4h5M20 15v5h-5" /></svg>No separate BranchBalance data server</div>
        </div>
      </div>
    </section>

    <section class="section-tight" id="open-source">
      <div class="shell open-source-panel">
        <div>
          <p class="eyebrow">Open for inspection</p>
          <h2>Want the technical details? They are available too.</h2>
          <p>BranchBalance is open-source software. Developers can inspect the calculations, security decisions, and source code without placing that detail in the way of everyday users.</p>
          <div class="hero-actions"><a class="button button-primary" href="https://github.com/BrunoV21/BranchBalance">View source on GitHub</a><a class="button button-secondary" :href="`${docsUrl}#developers`">Developer guides</a></div>
        </div>
        <div class="license-seal" aria-label="MIT licensed open-source software"><div><strong>MIT</strong><span>Open source</span></div></div>
      </div>
    </section>
    <div class="bb-page-footer-space" />
  </div>
</template>
