---
title: Release process
description: Stage and publish a signed BranchBalance Android APK with release notes sourced from the documentation.
outline: deep
---

# Release process

BranchBalance releases use the same Markdown file for the website and GitHub release body. A tag builds a signed APK and stages a draft; that exact APK must be tested before publication.

## One-time Android signing setup

The release workflow generates the native Android project and compiles the APK with Gradle on the GitHub-hosted runner. It does not use Expo's remote build service.

Before the first release, create the permanent Android release keystore:

```sh
mkdir -p signing
keytool -genkeypair \
  -storetype PKCS12 \
  -keystore signing/branchbalance-release.jks \
  -alias branchbalance \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

Back up the keystore and its passwords securely. Every release must use this same key or Android will reject application upgrades. The repository ignores `.jks` files and generated native directories; never force-add the keystore.

Configure these GitHub Actions repository secrets:

- `ANDROID_KEYSTORE_BASE64`: Base64-encoded contents of `branchbalance-release.jks`.
- `ANDROID_KEYSTORE_PASSWORD`: Keystore password.
- `ANDROID_KEY_ALIAS`: Key alias, such as `branchbalance`.
- `ANDROID_KEY_PASSWORD`: Key password.

## 1. Finish acceptance

Run the complete automated validation in the [testing guide](../reference/testing), resolve any source-level acceptance issues, and prepare the accounts and devices for the final APK test. The workflow-built release APK receives the physical-device acceptance pass in step 4.

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

The release workflow validates the app, version alignment, notes contract, and release link. It then runs Expo prebuild and Gradle locally on the runner, verifies the APK signature, generates `SHA256SUMS`, and attaches both files to a **draft** GitHub release. It deliberately does not publish from the tag alone.

## 4. Test and publish the built APK

Download the APK attached to the draft release, install it on a physical Android device, and run the complete two-account acceptance checklist against that exact file.

After it passes, run the **Release** workflow manually with the existing `tag`, such as `v1.0.0`.

The manual workflow validates the tag again, downloads the attached APK and checksum, verifies both, and publishes the GitHub release. It does not rebuild or replace the accepted APK.

Publishing the GitHub release triggers the Pages workflow so the releases page is rebuilt from the same Markdown source.
