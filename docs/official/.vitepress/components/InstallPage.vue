<script setup lang="ts">
import { withBase } from 'vitepress'

const docsUrl = withBase('/documentation/')
const groupsUrl = withBase('/guides/groups')
const releasesUrl = withBase('/releases/')
const primaryApkUrl = 'https://github.com/BrunoV21/BranchBalance/releases/download/v1.2.0/BranchBalance-v1.2.0-arm64-v8a.apk'
const legacyApkUrl = 'https://github.com/BrunoV21/BranchBalance/releases/download/v1.2.0/BranchBalance-v1.2.0-armeabi-v7a.apk'
</script>

<template>
  <div class="bb-install">
    <section class="install-hero">
      <div class="shell install-hero-grid">
        <div>
          <p class="eyebrow">Android installation</p>
          <h1 class="display-title">Get BranchBalance on your phone.</h1>
          <p class="section-lede">Download the Android app here, then follow the short setup below. You will not need to browse GitHub or choose between release files.</p>
          <div class="install-requirements" aria-label="Installation requirements">
            <span>Android phone</span>
            <span>Internet connection</span>
            <span>Free GitHub account</span>
          </div>
        </div>

        <aside id="download" class="download-card" aria-labelledby="download-title">
          <div class="download-card-icon">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 20h14" /></svg>
          </div>
          <div>
            <p class="download-kicker">Current stable version</p>
            <h2 id="download-title">BranchBalance v1.2.0</h2>
            <p>Android · about 124 MB · published 15 August 2026</p>
          </div>
          <a class="button button-primary button-download-direct" :href="primaryApkUrl" download>
            Download for most phones
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 20h14" /></svg>
          </a>
          <p class="download-host-note">For modern 64-bit Android phones. The verified APK downloads immediately from BranchBalance’s release storage—no GitHub page opens.</p>
          <details class="alternate-download">
            <summary>Using an older 32-bit phone?</summary>
            <p>Use this smaller build only if the main download will not install because your phone is 32-bit.</p>
            <a class="button button-secondary button-small" :href="legacyApkUrl" download>Download the 32-bit APK</a>
          </details>
          <a class="text-link" :href="releasesUrl">See version details and checksums</a>
        </aside>
      </div>
    </section>

    <section id="instructions" class="section section-rule">
      <div class="shell">
        <div class="section-heading install-heading">
          <div><p class="eyebrow">Four short steps</p><h2 class="section-title">Download, install, and start sharing.</h2></div>
          <p class="section-lede">Android may show an extra safety message because BranchBalance is not in the Play Store yet. The wording varies by phone.</p>
        </div>

        <ol class="install-steps">
          <li class="install-step">
            <span class="install-step-number">1</span>
            <div><h3>Download the app</h3><p>Tap <strong>Download for most phones</strong>. If your browser asks whether to keep the file, confirm that you want to download BranchBalance.</p></div>
          </li>
          <li class="install-step">
            <span class="install-step-number">2</span>
            <div><h3>Allow this installation</h3><p>Open the downloaded file. If Android asks, allow your browser to install this app, then tap <strong>Install</strong>. You can turn that permission off again afterward.</p></div>
          </li>
          <li class="install-step">
            <span class="install-step-number">3</span>
            <div><h3>Open BranchBalance</h3><p>Open the app and continue to GitHub. Sign in with an existing account or create a free one, then approve the one-time connection.</p></div>
          </li>
          <li class="install-step">
            <span class="install-step-number">4</span>
            <div><h3>Create or join a group</h3><p>Start a private Trip or Fuel group and invite people you know—or accept an invitation to an existing group.</p></div>
          </li>
        </ol>

        <div class="callout warning install-warning">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.5 20h19ZM12 9v4M12 17h.01" /></svg>
          <div><strong>Only install the copy downloaded from this website</strong><p>The safety prompt is expected for an app installed outside the Play Store. If the filename or source looks different, cancel and return to this page.</p></div>
        </div>
      </div>
    </section>

    <section class="section section-rule">
      <div class="shell audience-grid">
        <article class="audience-card">
          <div class="point-icon"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V10M7 15l5-5 5 5M5 4h14" /></svg></div>
          <p class="eyebrow">Starting a group?</p>
          <h2>You will connect BranchBalance once.</h2>
          <p>GitHub keeps the group private and lets you choose who can join. BranchBalance explains the requested access before sending you there.</p>
          <a class="button button-secondary" :href="groupsUrl">Read the first-group guide</a>
        </article>
        <article class="audience-card">
          <div class="point-icon"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="3" /><path d="M3 20v-2a5 5 0 0 1 10 0v2M16 11h5M18.5 8.5v5" /></svg></div>
          <p class="eyebrow">Joining a group?</p>
          <h2>Your route is shorter.</h2>
          <p>Install the app, sign in with the GitHub account that was invited, and accept the group invitation. You do not create another integration.</p>
          <a class="button button-secondary" :href="groupsUrl">Read the joining guide</a>
        </article>
      </div>
    </section>

    <section class="section-tight">
      <div class="shell help-panel">
        <div><p class="eyebrow">Need a hand?</p><h2>Installation did not work?</h2><p>Open the help centre for Android warning messages, download problems, GitHub sign-in, and group invitations.</p></div>
        <a class="button button-primary" :href="docsUrl">Open help &amp; guides</a>
      </div>
    </section>
    <div class="bb-page-footer-space" />
  </div>
</template>
