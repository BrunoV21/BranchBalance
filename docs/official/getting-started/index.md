---
title: Install and run the preview
description: Set up BranchBalance locally with Expo and an Android device or emulator.
---

# Install and run the preview

BranchBalance is currently an Android development preview. A stable APK has not been published yet.

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- Expo Go on an Android device, or an Android emulator
- A GitHub App configured for BranchBalance

## Install

```sh
git clone https://github.com/BrunoV21/BranchBalance.git
cd BranchBalance
npm install
cp .env.example .env
```

Set `EXPO_PUBLIC_GITHUB_CLIENT_ID` and `EXPO_PUBLIC_GITHUB_APP_SLUG` in `.env`, then start Expo:

```sh
npm start
```

Use `npm run android` for a device or emulator that can reach the development machine on the local network.

## Validate the checkout

```sh
npm run validate
```

Next, [configure the GitHub App](./github-app) or learn how to [connect an Android device over USB](./android-usb).
