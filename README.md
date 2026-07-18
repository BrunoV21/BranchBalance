# BranchBalance

BranchBalance is a peer-distributed expense splitter backed by private GitHub repositories. GitHub provides authentication, storage, and group membership, so Phase 1 does not require an application server.

The Expo application implements the Android Phase 1 and CR-001 spending-intelligence increment described by [`docs/PRD.md`](docs/PRD.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Phase 1

The Android-first Phase 1 is intended to support this complete flow:

1. Sign in through a GitHub App using device flow.
2. Create a group as a private `branch-balance-<slug>` repository.
3. Invite GitHub collaborators as group members.
4. Add, edit, and delete expense JSON files in `expenses/` using GitHub blob SHAs for conflict detection.
5. Compute balances and simplified settlements on the device.
6. Refresh on screen focus, app foreground, and pull-to-refresh while preserving cached data on transient failure.

CR-001 adds required category and payment-method metadata for new expenses, a Just me split shortcut, optional group and category budgets, optional trip dates, and a Spending tab with summaries, daily guidance, and combined filters. Existing expenses without the new metadata continue to load as Uncategorized and Unspecified, and spending metadata never changes balances or settlements.

Offline Git sync, settle-up records, percentage splits, currency conversion, notifications, and iOS release builds are outside Phase 1.

## Stack

- Expo SDK 57 and React Native 0.86
- TypeScript and Expo Router
- `@octokit/rest` with a directly controlled GitHub device-flow transport
- `expo-secure-store` for one atomic rotating access/refresh credential record
- AsyncStorage for versioned non-secret account and group snapshots
- Zod for GitHub-backed document and cache validation
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
4. Keep expiring user authorization tokens enabled. GitHub App device-flow refresh does not require shipping a client secret.
5. Copy the app's client ID and app slug. Do not copy or expose its client secret.

Create the local environment file:

```sh
cp .env.example .env
```

Set `EXPO_PUBLIC_GITHUB_CLIENT_ID` and `EXPO_PUBLIC_GITHUB_APP_SLUG` in `.env`. Expo public variables are embedded in the application bundle, which is appropriate for this public metadata but never for a client secret.

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

### Android device over USB

The default Expo connection uses the local network. If the Android device is using mobile data, has Wi-Fi disabled, or cannot reach the Mac on the same network, Expo Go may report `Failed to download remote update`.

With USB debugging enabled and the device connected, route Metro through USB and start Expo in localhost mode:

```sh
adb devices
adb reverse tcp:8081 tcp:8081
npx expo start --localhost --android
```

Run `adb reverse` again after reconnecting or restarting the device. If the device and Mac are on the same Wi-Fi network, `npm run android` is sufficient.

## Validation

```sh
npm run typecheck
npm run lint
npm test -- --runInBand
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
  <uuid>.json
```

`group.json` holds the display name, currency, creator, creation time, and optional shared spending plan. Every expense is a separate JSON document containing its amount, date, payer, deterministic shares, category, payment method, and audit fields. GitHub's live collaborator list is the source of truth for membership. No empty expenses directory is created; the first expense creates it.

See the [Phase 1 PRD](docs/PRD.md) for product requirements, the [architecture guide](docs/ARCHITECTURE.md) for implementation decisions, and the [testing guide](docs/TESTING.md) for automated and physical-device acceptance.

## Security

Access and refresh tokens are stored together with their expiries in `expo-secure-store`. Environment files and signing artifacts are ignored by Git. Never add a GitHub client secret, token, keystore, or service credential to the application source or repository.

## License

[MIT](LICENSE)
