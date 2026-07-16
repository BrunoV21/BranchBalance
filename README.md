# BranchBalance

BranchBalance is a peer-distributed expense splitter backed by private GitHub repositories. GitHub provides authentication, storage, and group membership, so Phase 1 does not require an application server.

This repository currently contains the Expo/React Native foundation and GitHub device-flow wiring described in [`docs/PRD.md`](docs/PRD.md). Expense and group workflows remain to be implemented.

## Phase 1

The Android-first Phase 1 is intended to support this complete flow:

1. Sign in through a GitHub App using device flow.
2. Create a group as a private `branch-balance-<slug>` repository.
3. Invite GitHub collaborators as group members.
4. Store each expense as an append-only JSON file in `expenses/`.
5. Compute balances and simplified settlements on the device.
6. Refresh repository data manually from GitHub.

Offline Git sync, edit/delete, settle-up records, percentage splits, currency conversion, notifications, and iOS release builds are outside Phase 1.

## Stack

- Expo SDK 57 and React Native 0.86
- TypeScript and Expo Router
- `@octokit/rest` and `@octokit/auth-oauth-device`
- `expo-secure-store` for the GitHub access token
- React Context and hooks for application state as features are added

## Prerequisites

- Node.js 20 or newer
- npm 10 or newer
- Expo Go on an Android device, or an Android emulator
- A GitHub App configured for BranchBalance

## GitHub App setup

Create a GitHub App in **GitHub Settings > Developer settings > GitHub Apps**.

1. Enable **Device Flow**.
2. Grant repository **Administration** and **Contents** read/write permissions.
3. Configure the app installation to cover repositories created for BranchBalance.
4. For Phase 1, disable expiring user authorization tokens. A client-only app cannot safely hold the client secret needed to refresh them.
5. Copy the app's client ID. Do not copy or expose its client secret.

Create the local environment file:

```sh
cp .env.example .env
```

Set `EXPO_PUBLIC_GITHUB_CLIENT_ID` in `.env`. Expo public variables are embedded in the application bundle, which is appropriate for a client ID but never for a client secret.

## Install and run

```sh
npm install
npm start
```

Scan the QR code with Expo Go, or use one of the platform scripts:

```sh
npm run android
npm run web
```

## Validation

```sh
npm run typecheck
npm run lint
npm run doctor
```

## Android APK

The `preview` EAS profile produces a sideloadable APK. Install the EAS CLI, authenticate, and build locally on macOS:

```sh
npx eas-cli build --platform android --profile preview --local
```

Local Android builds also require the Android SDK and Java toolchain expected by Expo. The app identifier is `com.branchbalance.app`.

## Repository data

Each group is a private repository named `branch-balance-<group-slug>`. It contains:

```text
group.json
expenses/
  .gitkeep
  <uuid>.json
```

`group.json` holds the display name, currency, creator, and creation time. Every expense is a separate immutable JSON document containing its payer, positive amount, split type, participants, creator, and timestamp. GitHub's live collaborator list is the source of truth for membership.

See the [Phase 1 PRD](docs/PRD.md) for schemas, API endpoints, balance computation, acceptance criteria, and deferred decisions.

## Security

Access tokens are stored with `expo-secure-store`. Environment files and signing artifacts are ignored by Git. Never add a GitHub client secret, access token, keystore, or service credential to the application source or repository.

## License

[MIT](LICENSE)
