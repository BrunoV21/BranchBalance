# BranchBalance testing guide

BranchBalance is developed test-first. A behavior is not complete until its unit, mocked integration, or component test has first failed for the expected reason and then passes with the implementation.

## Automated checks

Install exact locked dependencies and run the complete gate:

```sh
npm ci
npm run validate
```

Individual development commands are:

```sh
npm test -- --runInBand
npm run test:watch
npm run test:coverage
npm run typecheck
npm run lint
npm run doctor
```

Tests must not contact GitHub. Service tests use injected scripted request clients, clocks, delays, credential stores, and snapshot stores. Fixtures must contain invented tokens, accounts, repository names, and expense details. Never snapshot authorization headers, OAuth request bodies, or private GitHub file contents.

## GitHub App test configuration

Create a development GitHub App with device flow and expiring user authorization tokens enabled. Grant Metadata read, Contents read/write, and Administration read/write. Install it on the creator's personal account with access to all repositories.

Set only its public metadata locally:

```text
EXPO_PUBLIC_GITHUB_CLIENT_ID=...
EXPO_PUBLIC_GITHUB_APP_SLUG=...
```

Never put the client secret in the application or environment. Use two non-production GitHub accounts for acceptance and delete test repositories manually after the run.

## Physical Android acceptance

Use at least two physical app sessions signed in as different GitHub accounts.

1. Install the local preview APK and confirm first launch shows sign-in without a route flash.
2. Start device flow, copy the code, close and reopen the browser, and complete authorization. Cancel and expired/denied flows must also return safely to sign-in.
3. Restart the process and confirm the signed-in session and cached group summaries restore.
4. Exercise an expired access token and confirm refresh-token rotation lets the interrupted request complete. An invalid refresh token must clear the account cache and explain why sign-in is required.
5. Create an EUR group and confirm GitHub contains a private `branch-balance-<slug>` repository with `group.json` on its reported default branch.
6. Simulate a failed `group.json` bootstrap and confirm retry finishes that repository instead of creating another one.
7. Invite the second account, confirm Pending is shown, accept on GitHub, authorize the app as the invitee, and refresh until Member is shown and the group is discovered.
8. Add an uneven equal expense shared by three identities and verify deterministic remainder allocation. Add a full-to-one expense and confirm the payer cannot be the debtor.
9. Confirm Overview, Balances, and Members use one consistent snapshot; verify paid totals, net balances, and simplified transfers sum to zero.
10. Edit the same expense from both sessions. The stale session must retain its form, show the latest remote version, and require reapply or discard.
11. Delete an expense with the named amount confirmation and verify both sessions remove it after focus, foreground, or pull-to-refresh.
12. Disconnect networking during refresh. Cached data must remain visible with retry. Restore networking and retry successfully.
13. Add a malformed expense file on GitHub. Refresh must show a safe warning and exclude it from balances.
14. Revoke repository access and confirm the private group snapshot and descriptor are removed on confirmed access loss.
15. Create cached EUR and USD groups and confirm aggregate owed/owing values remain separated by currency.
16. Switch Android system theme and each explicit theme override; verify labels, money meaning, and controls remain readable without relying on color alone.

## Local APK

After the automated gate and manual test setup pass:

```sh
npx eas-cli build --platform android --profile preview --local
```

Install the resulting APK on an Android phone, repeat the complete two-account product loop, and record the app version, device/Android versions, GitHub test accounts, test repositories, and observed result for each checklist item.
