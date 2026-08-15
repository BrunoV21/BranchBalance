---
title: Run BranchBalance from source
description: Set up the BranchBalance development build with Expo and an Android device or emulator.
---

# Run BranchBalance from source

This guide is for contributors building the app locally. If you only want to use BranchBalance, follow the [Android install guide](../install) instead.

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- Expo Go on an Android device, or an Android emulator
- A GitHub App configured for BranchBalance

## Install the project

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

Next, [configure the GitHub App](../getting-started/github-app) or learn how to [connect an Android device over USB](../getting-started/android-usb).
