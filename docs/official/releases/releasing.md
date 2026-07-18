---
title: Release process
description: Stage and publish a signed BranchBalance Android APK with release notes sourced from the documentation.
outline: deep
---

# Release process

BranchBalance releases use the same Markdown file for the website and GitHub release body. A tag stages a draft; a tested signed APK is required before publication.

## 1. Finish acceptance

Run the complete automated validation and the two-account physical-device checklist in the [testing guide](../reference/testing). Record the tested APK and device details before tagging.

## 2. Prepare stable notes

Create `docs/official/releases/vX.Y.Z.md`. The tag, `package.json`, and `app.json` versions must agree. Stable notes must declare `status: stable`, link to the future GitHub release URL, and place the release body between the markers:

```md
---
title: v1.0.0
description: First stable Android release.
date: 2026-07-18
status: stable
channel: Stable Android
---

# v1.0.0

<!-- release-notes:start -->

[GitHub release](https://github.com/BrunoV21/BranchBalance/releases/tag/v1.0.0)

## Highlights

- Describe the user-visible release.

<!-- release-notes:end -->
```

## 3. Stage the release

Create and push the matching tag:

```sh
git tag v1.0.0
git push origin v1.0.0
```

The release workflow validates the app, version alignment, notes contract, and release link, then creates a **draft** GitHub release. It deliberately does not publish from the tag alone.

## 4. Attach the accepted APK

Build the signed preview-profile APK as documented in the repository README and test that exact file. Either attach it and a SHA-256 checksum to the draft manually, or upload it to an HTTPS-accessible artifact location and run the **Release** workflow manually with:

- `tag`: the existing tag, such as `v1.0.0`
- `apk_url`: the URL of the physically accepted signed APK

The manual workflow validates the tag again, verifies the download is a readable APK archive, attaches the APK and `SHA256SUMS`, and publishes the GitHub release.

Publishing the GitHub release triggers the Pages workflow so the releases page is rebuilt from the same Markdown source.
