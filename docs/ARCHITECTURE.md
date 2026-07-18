# BranchBalance — Phase 1 Architecture and CR-001 Increment

**Status:** Phase 1 implementation guide; CR-001 increment implemented
**Applies to:** Phase 1 Android application and CR-001 trip and group spending intelligence
**Companion specification:** [`PRD.md`](PRD.md)
**Last updated:** 2026-07-18

## 1. Purpose and decision precedence

This document turns the Phase 1 product requirements and the screens in `mockups/` into an implementation blueprint. Together with the PRD, it is intended to be sufficient to implement, test, and package the application without making additional architectural decisions.

Use this precedence when sources disagree:

1. The PRD defines product scope, persisted business rules, and acceptance criteria.
2. The explicit decisions in this document fill gaps or deliberately adapt a mockup.
3. The mockups define visual hierarchy and intended interactions, but not additional product scope.
4. The current scaffold demonstrates feasibility only; it is not an architectural constraint.
5. `README.md` is introductory. Its statements about non-expiring tokens, immutable expenses, manual-only refresh, and `.gitkeep` are stale where they conflict with the PRD.

The following clarifications are intentional:

| Area | Architecture decision |
|---|---|
| Expense date | New expenses persist an `expense_date` calendar date separately from audit timestamps. |
| Group-list summaries | Render cached summaries immediately; refresh complete group data only when that group is opened or explicitly refreshed. |
| Navigation | Overview, Balances, and Members are tabs within a selected group. The global group list has no ambiguous Balances or People tabs. |
| Currencies | Phase 1 supports `EUR`, `USD`, and `GBP`, with `EUR` as the default. |
| Mixed-currency summary | Never add currencies together. Show a separate cached total for each currency. |
| Theme | Follow the Android system theme by default and persist an optional light or dark override. |
| Member names | GitHub login is canonical. Profile name and avatar are best-effort presentation data with an `@login` fallback. |

## 2. System context and constraints

BranchBalance is an Android Expo application that communicates directly with GitHub. There is no BranchBalance server, background worker, push service, or database.

```text
┌────────────────────────── Android application ──────────────────────────┐
│                                                                        │
│  Expo Router UI → use cases → domain functions → repositories/gateways │
│        ↑                ↓                    ↓                          │
│  React contexts   in-memory state      SecureStore / AsyncStorage      │
│                                             ↓                          │
└──────────────────────────────────────── GitHub REST and OAuth APIs ─────┘
```

GitHub is authoritative for identity, repository access, membership, group metadata, and expenses. Local storage is only a credential store and a stale-while-revalidate cache. Phase 1 never queues writes for later and never represents a cached mutation as remotely committed.

Architectural quality requirements:

- **Correct money:** persist and calculate integer minor units only; all ordering and remainder allocation is deterministic.
- **Secure sessions:** tokens live only in SecureStore, rotate atomically, and are never logged.
- **Consistent snapshots:** a refresh replaces group data and its derived totals in one state transition.
- **Explicit conflicts:** edits and deletes use blob SHAs and never silently overwrite remote changes.
- **Resilient reads:** cached data remains visible during refresh and transient failure, while confirmed access loss purges private cached data.
- **Controlled API use:** paginate all list endpoints, coalesce duplicate work, and bound fan-out requests.
- **Testable logic:** OAuth timing, GitHub transport, clocks, UUIDs, and storage are injected behind narrow interfaces.

Android is the supported runtime. Web may remain useful for developer previews, but differences in OAuth CORS, SecureStore, native date input, and APK behavior mean web is not an acceptance target. iOS-specific behavior is out of scope.

## 3. Technology choices

Retain the existing Expo SDK, React Native, TypeScript strict mode, Expo Router, Octokit REST client, SecureStore, and managed workflow.

Add these direct runtime dependencies when their feature is implemented:

| Dependency | Purpose |
|---|---|
| `@react-native-async-storage/async-storage` | Versioned non-secret account and group snapshots, theme choice, and recoverable operation metadata |
| `zod` | Runtime validation of GitHub-backed JSON, cached records, and selected transport responses |
| `expo-clipboard` | Copy the GitHub device code |
| `expo-crypto` | Generate expense UUIDs |
| `@react-native-community/datetimepicker` | Native Android expense-date selection |
| `lucide-react-native` and `react-native-svg` | Accessible native equivalents of the mockup icons |

Install Expo/native packages with `npx expo install` so their versions match the installed SDK. Declare `zod` directly even if it is currently present only as a transitive dependency.

Add `jest`, `jest-expo`, `@types/jest`, and `@testing-library/react-native` as direct development dependencies. Tests should use injected fake transports rather than depending on live GitHub or a process-wide HTTP mock for most integration coverage.

Do not add a global state library, data-fetching framework, local SQL database, Git client, or decimal arithmetic library in Phase 1. Contexts plus reducers are sufficient, snapshots are small JSON documents, and persisted amounts are integers.

## 4. Source organization and dependency direction

Use the following target organization. Exact component granularity may evolve, but dependencies must point downward: screens may use features and UI; features may use domain and infrastructure interfaces; domain code imports neither React Native nor Octokit.

```text
src/
├── app/
│   ├── _layout.tsx
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   ├── sign-in.tsx
│   │   └── device-code.tsx
│   └── (app)/
│       ├── _layout.tsx
│       ├── account.tsx
│       └── groups/
│           ├── index.tsx
│           ├── new.tsx
│           └── [owner]/[repo]/
│               ├── _layout.tsx
│               ├── (tabs)/
│               │   ├── _layout.tsx
│               │   ├── index.tsx
│               │   ├── balances.tsx
│               │   └── members.tsx
│               └── expenses/
│                   ├── new.tsx
│                   └── [id]/
│                       ├── index.tsx
│                       └── edit.tsx
├── components/
│   ├── ui/
│   └── branch-balance/
├── config/
├── domain/
│   ├── groups/
│   ├── expenses/
│   ├── balances/
│   └── money/
├── features/
│   ├── auth/
│   ├── groups/
│   ├── members/
│   └── expenses/
├── infrastructure/
│   ├── github/
│   └── storage/
├── providers/
└── test/
```

Each feature owns its reducer, use cases, hooks, and feature-specific presentation components. Cross-feature concepts belong in the domain or shared UI only after they have a stable contract.

The important infrastructure boundaries are:

```ts
interface CredentialStore {
  read(): Promise<StoredCredentialV1 | null>;
  replace(value: StoredCredentialV1): Promise<void>;
  clear(): Promise<void>;
}

interface SnapshotStore {
  readAccount(accountId: number): Promise<AccountCacheV1 | null>;
  writeAccount(accountId: number, value: AccountCacheV1): Promise<void>;
  readGroup(accountId: number, key: GroupKey): Promise<GroupSnapshotV1 | null>;
  writeGroup(accountId: number, key: GroupKey, value: GroupSnapshotV1): Promise<void>;
  removeGroup(accountId: number, key: GroupKey): Promise<void>;
  clearAccount(accountId: number): Promise<void>;
}

interface Clock {
  now(): Date;
}

interface IdGenerator {
  expenseId(): string;
}
```

The GitHub gateway exposes product operations rather than leaking Octokit response types into features:

```ts
interface GitHubGateway {
  getCurrentAccount(signal?: AbortSignal): Promise<AccountProfile>;
  discoverGroups(signal?: AbortSignal): Promise<DiscoveredGroup[]>;
  createPrivateRepository(slug: string, signal?: AbortSignal): Promise<RepositoryRef>;
  readGroup(repository: RepositoryRef, signal?: AbortSignal): Promise<GroupFile>;
  createGroupFile(repository: RepositoryRef, group: Group, signal?: AbortSignal): Promise<GroupFile>;
  refreshGroup(repository: RepositoryRef, signal?: AbortSignal): Promise<RemoteGroupSnapshot>;
  inviteMember(repository: RepositoryRef, login: string, signal?: AbortSignal): Promise<void>;
  createExpense(repository: RepositoryRef, expense: Expense, signal?: AbortSignal): Promise<ExpenseFile>;
  updateExpense(repository: RepositoryRef, expense: Expense, sha: string, signal?: AbortSignal): Promise<ExpenseFile>;
  deleteExpense(repository: RepositoryRef, expense: Expense, sha: string, signal?: AbortSignal): Promise<void>;
}
```

## 5. Navigation and screen ownership

The root layout mounts `ThemeProvider`, `SessionProvider`, the root stack, and the status bar. It keeps the splash screen visible until SecureStore hydration finishes so users do not briefly see sign-in while an existing session is being restored.

The `(auth)` layout redirects an authenticated user to `/groups`. The `(app)` layout redirects an unauthenticated user to `/sign-in`. Session expiry carries a one-time, non-secret reason such as `refresh_expired` so sign-in can explain why reauthorization is required.

### 5.1 Auth screens

- **Sign in** follows mockup 01. It starts device flow and navigates to the device-code screen after a code is received.
- **Device code** follows mockup 02. It displays and copies the code, opens `verification_uri`, shows expiry, reports pending/slow-down/denied/expired states, and offers cancel/restart. Successful authorization replaces the route with `/groups`.
- Browser dismissal is not authorization cancellation. Polling continues until the user explicitly cancels, the code expires, GitHub denies it, or authorization succeeds.

### 5.2 Group screens

- **Groups** follows mockup 03 without its global bottom tabs. It shows cached currency-separated owed/owing totals, group cards, their last successful sync time, member preview, current-user balance, pull-to-refresh, account avatar, and create action.
- **Create group** follows mockup 04. It previews the slug and private repository, locks the supported currency list, checks installation prerequisites, and owns partial-creation recovery.
- **Account modal** is reached from the avatar. It shows the authenticated GitHub account, theme preference, installation management link, and sign-out confirmation.

### 5.3 Selected-group screens

The selected group owns a stack whose initial route is a nested three-tab layout:

- **Overview** follows mockup 05 and shows all expenses newest first, not just a hard-coded recent subset. Each item exposes description, amount, payer, split summary, creator, and creation/update time as required by the PRD. It uses a virtualized list and contains the add-expense action.
- **Balances** follows mockup 09 and derives totals and simplified settlements from the exact same snapshot as Overview.
- **Members** follows mockup 08. Only the personal repository owner sees an enabled invitation form. Member overflow/removal controls are omitted because removal is Phase 2.
- **Expense detail** shows all persisted/audit information and Edit/Delete actions. This supplies the PRD detail route that is not separately mocked.
- **Add/Edit expense** reuse one form component based on mockups 06 and 07. Edit starts from an immutable copy of the loaded file and retains its SHA.

Tabs remain mounted against one `GroupProvider`, so moving between Overview, Balances, and Members does not trigger three independent requests. Expense screens consume the same provider and apply successful mutations to it immediately.

## 6. UI architecture

Translate the mockup CSS into native theme tokens rather than copying web-only layout rules. Tokens cover background/surface levels, text roles, border strengths, accent, positive, negative, warning, radii, spacing, elevation, body typography, and display typography. Android's system `serif` family may be used for display text; body text uses the platform sans-serif.

`ThemeProvider` resolves one of three stored preferences: `system`, `light`, or `dark`. `system` listens to `Appearance`; a user override remains stable when the system changes. Headers expose a light/dark shortcut while Account can restore `system`.

Build reusable native primitives for screen containers, headers, cards, buttons, icon buttons, fields, segmented controls, avatars, pills, banners, sync badges, empty/error states, money text, confirmation dialogs, and bottom tabs. Feature components compose these primitives; screens should not duplicate the entire mockup stylesheet as local `StyleSheet` objects.

Minimum interaction requirements:

- Tap targets are at least 44 by 44 density-independent pixels.
- Buttons and icons have accessibility roles, labels, disabled states, and visible pressed/focus states.
- Loading and error updates use live-region announcements where appropriate.
- Forms use keyboard avoidance, focus the first invalid field, preserve values after a failed request, and disable duplicate submission.
- Money meaning is never communicated by color alone; pair color with “owes”, “is owed”, or signed text.
- Delete uses a modal confirmation naming the description and formatted amount.
- Pull-to-refresh and explicit retry invoke the same coalesced use case.

## 7. Domain model and persisted schemas

### 7.1 Canonical identifiers

```ts
type GroupKey = `${string}/${string}`; // normalized owner/repository
type CurrencyCode = 'EUR' | 'USD' | 'GBP';
type SplitType = 'equal' | 'full';
type IsoInstant = string; // validated UTC ISO 8601
type CalendarDate = string; // validated YYYY-MM-DD
```

GitHub logins are case-insensitive. Normalize them to lowercase for comparisons and map keys, while preserving GitHub's returned login for display and persistence. Expense IDs are lowercase UUID v4 strings. A repository key is the lowercase `owner/repo` pair, not a display name.

### 7.2 Group model

The PRD's `group.json` schema is unchanged. Runtime parsing uses a passthrough Zod object: validate every known field and retain forward compatibility by ignoring unknown fields in domain calculations.

```ts
interface Group {
  schema_version: 1;
  name: string;
  currency: CurrencyCode;
  created_by: string;
  created_at: IsoInstant;
}
```

`name` is required after trimming. Currency cannot change after creation in Phase 1, so there is no group-edit UI.

The repository slug algorithm is fixed:

1. Trim the group name and Unicode-normalize it with NFKD.
2. Remove combining marks and lowercase the result.
3. Replace each run outside ASCII `a-z` and `0-9` with one hyphen.
4. Trim leading/trailing hyphens and collapse repeats.
5. Reject a result with no alphanumeric characters.
6. Truncate the slug to 85 characters, then trim a possible trailing hyphen, so `branch-balance-<slug>` stays within GitHub's 100-character repository-name limit.

### 7.3 Expense model

New writes extend the PRD expense document with `expense_date`:

```ts
interface Expense {
  schema_version: 1;
  id: string;
  description: string;
  amount_minor: number;
  currency: CurrencyCode;
  paid_by: string;
  split_type: SplitType;
  participants: string[];
  shares_minor: Record<string, number>;
  expense_date: CalendarDate;
  created_by: string;
  created_at: IsoInstant;
  updated_by: string | null;
  updated_at: IsoInstant | null;
}

interface ExpenseFile {
  expense: Expense;
  blobSha: string;
  path: `expenses/${string}.json`;
}
```

Readers accept a schema-version-1 file without `expense_date` and derive it from the first 10 characters of valid `created_at`. Writers always include it. This is a backward-compatible read rule, not permission to omit it from new files.

The selected date is a calendar fact and has no timezone conversion. New forms default it from the device's current local calendar date. Audit timestamps always use `clock.now().toISOString()` in UTC. Editing the date does not alter `created_at`.

Sort expenses by `expense_date` descending, then `created_at` descending, then normalized `id` ascending. This keeps ordering deterministic even after date edits or clock ties.

Use Zod plus explicit cross-field validation for every PRD invariant. Unknown fields are ignored. Invalid files produce a warning containing path and safe reason, but never enter totals. Do not render raw malformed JSON or GitHub response bodies to users.

### 7.4 Money and shares

Configure currencies in one exhaustive record:

```ts
const currencies = {
  EUR: { minorDigits: 2, symbol: '€' },
  USD: { minorDigits: 2, symbol: '$' },
  GBP: { minorDigits: 2, symbol: '£' },
} as const;
```

Parse an amount from its input string without first converting through a floating-point number. Accept either `.` or `,` as the decimal separator, but reject a value containing both, grouping separators, signs, exponent notation, more than two fractional digits, zero, or a value above `Number.MAX_SAFE_INTEGER` minor units. Pad one fractional digit and convert the concatenated major/fraction digits to an integer.

Format only at the presentation boundary with `Intl.NumberFormat`, the group currency, and device locale. Never parse a formatted display value.

Equal allocation:

1. Normalize and deduplicate selected participants.
2. Sort by lowercase GitHub login, using the original login as the final tie-breaker.
3. Compute integer quotient and remainder.
4. Assign the quotient to everyone and one additional minor unit to the first `remainder` logins.

Full allocation has exactly one participant, excludes the payer, and assigns the entire amount to that participant. Equal allocation may include or exclude the payer but requires at least one accepted member.

### 7.5 Balances and settlements

Expose pure functions:

```ts
function allocateEqual(amountMinor: number, participants: string[]): Record<string, number>;
function allocateFull(amountMinor: number, participant: string): Record<string, number>;
function calculateBalances(expenses: Expense[], currentMembers: Member[]): BalanceResult;
function simplifySettlements(balances: MemberBalance[]): Settlement[];
```

`BalanceResult` includes `totalSpentMinor`, each identity's paid total, share total, and net balance, plus a zero-sum integrity result. Seed identities from accepted members and add every historical login referenced by a valid expense so former collaborators remain visible.

Settlement matching follows the PRD. For equal amounts, break ties with normalized login ascending. Omit zero transfers. If balances do not sum to zero, return no settlements and surface a data-integrity warning rather than displaying a misleading plan.

Group summaries store the current user's balance and group currency separately. For each currency, the all-groups hero sums positive group balances into `owed_minor` and the absolute values of negative group balances into `owing_minor`; it does not net those two figures against one another. Omit currencies with no cached groups and show the oldest contributing `syncedAt` as the aggregate's “as of” time. It must never perform currency conversion or combine EUR, USD, and GBP values.

## 8. Authentication and session lifecycle

### 8.1 Stored credentials

Store one versioned JSON value under one SecureStore key so token rotation is a single replacement rather than a sequence of partially successful key writes:

```ts
interface StoredCredentialV1 {
  version: 1;
  accessToken: string;
  accessTokenExpiresAt: IsoInstant;
  refreshToken: string;
  refreshTokenExpiresAt: IsoInstant;
}
```

If token expiration is enabled but a successful device response omits any required field, treat sign-in as invalid and do not persist a partial session. The account profile is non-secret and belongs in the user-scoped cache, not the credential record.

### 8.2 Device flow

Replace the scaffold's one-call `signInWithGitHub` function with a `DeviceFlowController`. Use direct JSON OAuth requests for the device-code and token endpoints rather than the installed helper's internal polling loop, because the UI requires explicit expiry, denial, cancellation, interval changes, and an abort signal.

The controller state is a discriminated union:

```text
idle
requesting_code
awaiting_authorization { userCode, verificationUri, expiresAt, nextPollAt }
exchanging
authorized
denied
expired
cancelled
error { safeMessage, retryable }
```

Polling rules:

- Use GitHub's returned interval; do not poll early.
- `authorization_pending` schedules the next normal poll.
- `slow_down` adds GitHub's required delay to all later polls.
- `access_denied` stops in `denied`.
- `expired_token` or the locally reached expiry stops in `expired`.
- Explicit cancellation aborts the current request, clears timers, and ignores any late result.
- Network failure preserves the code until its expiry and offers retry without requesting a second code.
- Successful exchange validates and atomically stores the entire rotating token set before loading `/user`.

Browser close is not cancellation. Copy and browser-open actions remain available until the code expires.

### 8.3 Refresh and authenticated requests

`TokenManager.getValidAccessToken()` returns the existing token when it expires more than five minutes from `clock.now()`. Otherwise, it joins or starts one module-wide refresh promise. Refresh posts `client_id`, `grant_type=refresh_token`, and the current refresh token to the OAuth token endpoint; it never sends a client secret.

On success, validate and replace both tokens and both expiries as one SecureStore value before resolving waiting requests. On invalid, expired, or revoked refresh credentials, clear SecureStore, purge user-scoped cache, set the session reason, and redirect to sign-in. A transient network or 5xx refresh failure leaves the credential record intact and returns a retryable error.

All REST calls pass through one `AuthenticatedGitHubClient`:

1. Obtain a valid token.
2. Call Octokit with the token on that request.
3. On one unexpected 401, force the single-flight refresh and retry the original request once.
4. Mark the retry so another 401 ends the session instead of looping.

Use a 20-second timeout for ordinary REST calls. OAuth polling uses its own interval and per-request timeout. Centralize headers:

```text
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
Authorization: Bearer <token>
```

Never include token values, OAuth bodies, full private file contents, or authorization headers in logs or user-visible errors.

## 9. GitHub gateway behavior

The gateway maps Octokit DTOs to domain types and maps transport failures to typed application errors. Follow pagination for installations, installation repositories, collaborators, invitations, and any endpoint that returns pages.

### 9.1 Discovery

`discoverGroups` performs the PRD sequence:

1. List user-accessible GitHub App installations.
2. List every repository available through each installation.
3. Deduplicate by numeric repository ID.
4. Keep private repositories named with the `branch-balance-` prefix.
5. Read `group.json` from the reported default branch.
6. Parse it with the group schema and return only valid groups.

An invalid candidate is excluded and recorded as a safe discovery warning. Do not treat arbitrary prefixed repositories as groups. Repository references retain numeric IDs, owner login, name, default branch, installation ID, private flag, and current user's relevant permission flags.

The groups screen hydrates cached descriptors first, then coalesces initial-load, focus, foreground, retry, and pull triggers into one discovery promise. Discovery updates membership of the list and repository metadata, but does not fetch all expenses for all groups. A newly discovered group has an “Open to sync” summary until its first group refresh.

### 9.2 Installation prerequisite

Add `EXPO_PUBLIC_GITHUB_APP_SLUG` as public configuration and derive the management/install URL from it. The client ID and app slug are public metadata; a client secret is forbidden.

When creation is requested, verify that a relevant installation is accessible and explain that Phase 1 requires all-repositories coverage so the new repository is immediately included. If not, open the GitHub App installation page and provide a recheck action. An invited collaborator may access the owner's installation-backed repository without installing the app on their own account.

### 9.3 Group creation

Group creation is an explicit operation state:

```text
validating → creating_repository → writing_group_file → complete
                                      ↓
                              partial_creation
```

Generate the slug before submission and disable the form until the operation settles. Create a personal private repository, use the response's actual owner/name/default branch, and write only `group.json` through the Contents API on that branch with commit message `Initialize BranchBalance group`. Do not create `.gitkeep` or an empty `expenses/` directory; the first expense write creates the path.

If GitHub reports a repository-name collision before a repository was created by the current operation, return `repository_name_taken`; never inspect and attach that repository as a group. If the repository response succeeded but writing `group.json` failed, persist a non-secret `PendingGroupCreation` containing repository ID/ref and intended group document. Retry only the idempotent bootstrap step. Discovery continues ignoring the repository until the file is valid.

If the create-repository request has an ambiguous timeout, retrying the same repository name cannot create a duplicate, but the app must not claim ownership of an observed existing repository. Surface an “outcome unknown” recovery state, run discovery, and let the user retry bootstrap only after the operation can match a locally recorded repository response. Otherwise ask them to choose a different group name or inspect GitHub.

### 9.4 Complete group refresh

Only one refresh promise exists per repository key. A refresh builds a temporary `RemoteGroupSnapshot`:

1. Refresh repository metadata and default branch.
2. Read and validate `group.json`.
3. In parallel, fetch accepted collaborators and, when permitted, pending invitations.
4. Fetch the default branch's Git tree recursively and select files matching exactly `expenses/<uuid>.json`.
5. Fetch blobs with at most four concurrent requests.
6. Decode base64 as UTF-8, parse JSON, and validate expense path/content/group invariants.
7. Fetch missing public profiles with at most four concurrent requests; profile failure only removes enrichment.
8. Derive balances, settlements, summary, and warnings.
9. Commit the snapshot to reducer state and AsyncStorage as one logical update.

If the root recursive tree is truncated, locate the `expenses` subtree from a non-recursive tree response and request that subtree recursively. If that is also truncated, fail the refresh with a `repository_too_large` data error instead of calculating incomplete balances.

Accepted membership includes the personal repository owner and collaborators whose permissions include write/push, maintain, or admin. Pending invitations never enter expense forms or balances. A non-owner may receive 403 for pending invitations; represent pending data as unavailable, not as an empty authoritative list.

Before sending an invitation, trim and normalize the entered login and reject the repository owner, an accepted member, or a login already present in pending invitations. Revalidate against a refreshed member snapshot before a retry. Map unknown-user, permission, and invitation rate-limit failures to plain-language typed errors.

### 9.5 Profile enrichment

Canonical business records use GitHub login only. `GET /user` supplies the signed-in profile. For collaborators, use login/avatar data already returned and fetch `GET /users/{username}` only when a non-expired cached profile is missing. Profile name is optional, has no effect on identity, and falls back to `@login`. Cache enrichment for seven days to limit API use.

### 9.6 Expense writes

Serialize JSON with two-space indentation and a trailing newline, then encode the UTF-8 bytes as base64. Use one tested codec utility; do not call `btoa` directly on arbitrary Unicode descriptions.

Commit messages are deterministic and contain no amount:

- `Add expense <uuid>`
- `Update expense <uuid>`
- `Delete expense <uuid>`

For creation, generate one UUID when submission begins and retain it across retries. Write `expenses/<uuid>.json`. After an ambiguous failure, read that exact path before retrying: a valid matching remote file is success, absence is safe to retry, and different content is a conflict.

For editing, preserve `id`, `created_by`, and `created_at`; set `updated_by` and `updated_at`; write the same path with its latest known SHA. For deleting, send the latest SHA. Map stale-SHA 409/422 responses to `ExpenseConflict`, fetch the latest file, and show remote data alongside the user's unsaved form values. The only actions are reapply against the latest version or discard local changes.

For delete 404, confirm with a read of the exact path. If still absent, treat deletion as successful locally. Never automatically turn an edit conflict into a create.

After a confirmed write, update the in-memory expense file with the returned SHA, recompute all selectors synchronously, and persist the new snapshot. Do not wait for a full refresh, but let the next focus/foreground refresh verify GitHub state.

## 10. State, caching, and synchronization

### 10.1 Providers

Provider ownership is intentionally small:

- `ThemeProvider`: resolved theme and stored preference.
- `SessionProvider`: hydration, device flow, account, token lifecycle, and sign-out.
- `GroupsProvider`: cached/discovered group list and per-currency cached aggregates.
- `GroupProvider`: one selected group's snapshot, refresh, invitation, and expense mutation actions.

Use reducers with discriminated states rather than unrelated booleans. A resource state contains `data`, `status`, `isRefreshing`, `lastSuccessfulAt`, and an optional typed error. `data` remains present during background refresh and retryable failure.

Derived balances are selectors over a complete immutable snapshot. Do not separately mutate expenses and balance arrays; this prevents transient disagreement.

### 10.2 Cache records

AsyncStorage keys are versioned and user-scoped by immutable numeric GitHub account ID, for example:

```text
bb:v1:account:<account-id>
bb:v1:groups:<account-id>
bb:v1:group:<account-id>:<encoded-owner/repo>
bb:v1:profiles:<account-id>
bb:v1:pending-group:<account-id>
bb:v1:theme
```

Validate every cached record with Zod. Corrupt or unsupported versions are removed and treated as cache misses. A group snapshot stores repository/group metadata, accepted members, pending invitations or their unavailable state, valid expense files and SHAs, warnings, derived summary, and `syncedAt`.

AsyncStorage is app-sandboxed but not a credential vault. It must never receive access tokens, refresh tokens, device codes, or authorization headers.

### 10.3 Refresh triggers

Use `useFocusEffect` for focus refreshes and one root `AppState` subscription for foreground refreshes. Providers expose coalesced `refresh()` functions; screens do not create their own network effects.

- Groups: hydrate cache on mount; discover on authenticated launch, focus, foreground, pull, and retry.
- Selected group: hydrate its snapshot on route entry; refresh on first load, every group-tab focus, return from a pushed group screen, app foreground, pull, explicit refresh, and retry. Every trigger requests a refresh as required by the PRD but joins the repository's existing promise when one is already running.
- Foreground events refresh only the visible resource, not every cached group.

Abort resource requests when their provider permanently unmounts, except a confirmed write already accepted for submission: allow that use case to settle and ignore only its UI update if the session changed.

Transient network, timeout, server, and rate-limit errors preserve snapshots. A confirmed 404 or access-related 403 on a repository removes its cached group snapshot and group-list descriptor, then shows an access-lost state. Authentication failures follow the session rules instead.

Sign-out confirms intent, clears the secure credential first, clears the signed-in account's AsyncStorage records, resets all reducers, closes private screens, and replaces navigation with sign-in. Theme preference may remain because it is device-level and non-account-specific.

## 11. Error model and safe retry

Map low-level failures into a discriminated `AppError` union. At minimum include:

```ts
type AppError =
  | { kind: 'auth_required'; reason: 'missing' | 'refresh_expired' | 'revoked' }
  | { kind: 'network'; retryable: true }
  | { kind: 'timeout'; retryable: true }
  | { kind: 'rate_limit'; retryable: true; retryAt: IsoInstant | null; secondary: boolean }
  | { kind: 'permission'; operation: string }
  | { kind: 'not_found'; resource: string }
  | { kind: 'validation'; field?: string; message: string }
  | { kind: 'data_warning'; path: string; reason: string }
  | { kind: 'repository_name_taken'; repository: string }
  | { kind: 'partial_group_creation'; repository: RepositoryRef }
  | { kind: 'expense_conflict'; latest: ExpenseFile | null; operation: 'edit' | 'delete' }
  | { kind: 'repository_too_large' }
  | { kind: 'github'; status: number; safeMessage: string; retryable: boolean };
```

Read `Retry-After`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` centrally. Display a retry time when available and disable retry until that time only when GitHub explicitly requires it. Never expose raw error objects.

Every retry action must target the same operation identity:

- Device flow retry reuses an unexpired code.
- Refresh joins the current refresh promise.
- Partial group creation retries `group.json`, not repository creation.
- Expense creation retains its UUID and checks the remote path after ambiguity.
- Edit/delete retry first obtains the newest SHA and requires user review after conflict.
- Invitation retry revalidates owner, accepted, and pending membership first.

## 12. Security and privacy

- Never add a GitHub client secret, token, keystore, or credential-bearing fixture to the repository or Expo public environment variables.
- Keep the app client ID and app slug in public configuration; validate both at startup and show a developer-facing setup message in non-production builds.
- Store credential JSON only in SecureStore. Use the default Android authentication behavior so background-free Phase 1 is not blocked by biometric prompts.
- Redact authorization headers and private file bodies in diagnostics.
- Treat repository names, member identities, and expense data as private application data even though only tokens require encrypted storage under the Phase 1 design.
- Clear account-scoped snapshots on sign-out, revoked session, or confirmed repository access loss.
- Open only GitHub-provided HTTPS verification URLs and the configured GitHub App installation URL.
- Validate all GitHub file content before it reaches domain calculations or UI rendering.

## 13. Test architecture

### 13.1 Unit tests

Keep domain tests platform-free and table-driven. Cover:

- Amount parsing with dot/comma, invalid separators, precision, zero, and safe-integer bounds.
- EUR/USD/GBP formatting configuration.
- Equal allocation with zero and multiple remainder units and deterministic username ordering.
- Full allocation and payer exclusion.
- Group/expense parsing, unknown fields, every cross-field invariant, and legacy missing `expense_date` fallback.
- Expense-date sorting and UTC audit timestamps.
- Slug normalization, empty Unicode-only names, repeated separators, and length limit.
- Balance totals, former collaborators, payer excluded from split, and zero-sum detection.
- Deterministic settlement ties and no-settlement integrity failure.
- Credential expiry skew, single-flight refresh, rotated replacement, retry-once, and terminal refresh failure.
- Error mapping, UTF-8/base64 round trips, and cache-version rejection.

### 13.2 Service/integration tests

Inject a scripted transport, fake clock, in-memory stores, and deterministic UUID generator. Cover:

- Device-code pending, slow-down, copy/open-independent polling, denial, expiry, cancellation, network retry, and success metadata.
- Startup hydration with valid, near-expiry, expired-refresh, and corrupt credential records.
- Paginated installations/repositories and deduplication.
- Invalid candidate `group.json`, missing installation, and lost access.
- Repository creation success, name collision, partial bootstrap retry, and ambiguous create outcome.
- Paginated collaborators/invitations, non-owner pending 403, duplicate invitation validation, and pending-to-accepted transition.
- Complete tree/blob refresh, bounded concurrency, malformed files, truncated tree fallback, profile failure, and atomic snapshot replacement.
- Create, ambiguous create recovery, edit, delete, already-absent delete, and stale-SHA conflict.
- Focus/foreground/pull coalescing, repeated focus refreshes, stale-cache preservation, and per-repository concurrency isolation.
- Primary and secondary rate limits with and without a supplied retry time.

### 13.3 Component and navigation tests

Test behavior rather than snapshots of every style:

- Session hydration does not flash the wrong route.
- Sign-in/device-code state and accessible actions.
- Cached groups render while discovery is active.
- Currency-separated aggregate cards and mixed-currency behavior.
- Empty groups, no expenses, one accepted member, warnings, retry banners, and installation prerequisite.
- Group tabs share one snapshot and do not duplicate refreshes.
- Expense form validation, equal/full participant controls, native date updates, and disabled duplicate submission.
- Owner-only invitation form.
- Conflict review retains unsaved edits.
- Named delete confirmation and successful route return.
- System/light/dark selection and persistence.

### 13.4 Manual Android acceptance

Run the PRD's full two-account test on physical Android sessions. Additionally verify process restart with cached summaries, mixed-currency group cards, browser dismissal during device flow, theme/system changes, a non-owner Members screen, malformed expense warning, and repository access revocation.

Before producing the APK, require:

```sh
npm run typecheck
npm run lint
npm test
npm run doctor
```

Then build the `preview` EAS profile locally and install the APK on a physical Android phone.

## 14. Implementation sequence

Implement vertical capabilities in this order so each stage has a testable boundary:

1. **Foundation:** theme tokens/primitives, domain models, Zod schemas, money/split/balance functions, error types, storage interfaces, and tests.
2. **Session:** cancellable device flow, atomic credential record, authenticated client, refresh rotation, route guards, account modal, and auth tests.
3. **Groups:** versioned cache, installation check, discovery, cached summary list, creation/partial recovery, and group routes.
4. **Group reads:** collaborators, invitations, tree/blob loading, warnings, profiles, complete snapshot reducer, Overview/Balances/Members tabs, and lifecycle refreshes.
5. **Expense writes:** shared form, date support, create/detail/edit/delete, SHA conflicts, immediate recomputation, and safe retry.
6. **Hardening:** every explicit empty/error state, accessibility pass, rate limits, access-loss purge, two-account manual test, and local APK.

At the end of each stage, keep TypeScript, lint, and the accumulated automated suite green. Do not defer domain tests until UI completion.

## 15. Phase 1 completion boundary

The architecture is complete when the PRD acceptance criteria pass through the routes and services above. Do not expand implementation to offline mutation, local Git, settlement recording, group/member deletion, additional split types, currency conversion, receipt storage, notifications, organization-owned groups, iOS release behavior, or a BranchBalance backend.

Any future offline-write work must first replace mutable expense files with an explicit revision/tombstone model or define a merge protocol. The Phase 1 SHA conflict behavior is deliberately online-only and must not be reused as an offline synchronization strategy.

## 16. CR-001 architecture delta — Trip and group spending intelligence

**Increment status:** Implemented; physical-device acceptance pending

Section 15 remains the Phase 1 completion boundary. This section defines the additive architecture for PRD change request CR-001 and authorizes only that increment. Unless explicitly changed below, every Phase 1 decision remains in force: GitHub stays authoritative, writes remain online-only, one group has one currency, integer minor units remain the money representation, and category, payment-method, budget, and trip metadata never affect shares, balances, or settlements.

### 16.1 Source, navigation, and screen ownership

CR-001 adds a spending domain and feature without adding a provider or an independent synchronization path:

```text
src/
├── app/(app)/groups/[owner]/[repo]/
│   ├── (tabs)/spending.tsx
│   └── spending-plan/edit.tsx
├── domain/spending/
└── features/spending/
```

The existing date picker, Zod validation, reducers, and native layout primitives are sufficient. Do not add a charting, decimal-math, database, or data-fetching dependency for CR-001; optional progress visuals can be composed from accessible native views.

The selected-group tab layout becomes **Overview**, **Spending**, **Balances**, and **Members**. All four tabs and the spending-plan editor consume the existing `GroupProvider` and therefore render one repository snapshot generation.

- **Overview** keeps the expense list and add action. When a total budget exists, it also renders a compact selector-backed summary containing budget, spent, remaining or over-budget amount, percentage used, and available-per-day guidance when defined.
- **Spending** owns the complete textual spending summary: group total, current-user paid and share totals, budget progress, trip guidance, category totals and limits, payment-method totals, and combined expense filters. Filters are ephemeral feature/UI state and never modify the snapshot or persisted documents.
- **Spending-plan editor** is a pushed form screen. Any accepted member with repository write access may set, edit, or remove the plan. It retains the `group.json` blob SHA and an immutable copy of the loaded plan for conflict review.
- **Add/Edit expense** extends the shared Phase 1 form with required category and payment-method controls and a `Just me` split shortcut. Changing payer while that shortcut is selected rewrites the sole participant and share in the draft before validation.
- **Expense list/detail** display a category and payment-method label. Legacy nulls render as **Uncategorized** and **Unspecified** respectively.

The Spending tab does not fetch on its own. Tab focus requests the same coalesced `GroupProvider.refresh()` used by the other selected-group screens. Charts are optional leaf presentation components; accessible text values are the authoritative UI and must remain available when charts are absent.

### 16.2 Persisted and runtime types

Define the closed taxonomies once in the domain and derive form options, labels, icons, filters, schemas, and exhaustive records from them:

```ts
const expenseCategories = [
  'accommodation',
  'food_drink',
  'groceries',
  'transport',
  'activities',
  'shopping',
  'fees',
  'other',
] as const;

type ExpenseCategory = (typeof expenseCategories)[number];
type PaymentMethod = 'card' | 'cash' | 'other';
type CategoryBucket = ExpenseCategory | 'uncategorized';
type PaymentMethodBucket = PaymentMethod | 'unspecified';

interface SpendingPlan {
  budget_minor?: number;
  category_budgets_minor?: Partial<Record<ExpenseCategory, number>>;
  starts_on?: CalendarDate;
  ends_on?: CalendarDate;
  updated_by: string;
  updated_at: IsoInstant;
}

interface Group {
  schema_version: 1;
  name: string;
  currency: CurrencyCode;
  spending_plan?: SpendingPlan;
  created_by: string;
  created_at: IsoInstant;
}

interface GroupFile {
  group: Group;
  blobSha: string;
  path: 'group.json';
  // Validated passthrough document retained so updates preserve unknown keys.
  sourceDocument: Record<string, unknown>;
}
```

Remote `schema_version` remains `1`. Parse `group.json` in two stages: validate the Phase 1 base group first, then validate `spending_plan` independently. An invalid spending plan is omitted from the runtime `Group`, adds a safe `data_warning` for `group.json#spending_plan`, and does not exclude the group or any valid expense. A present plan must satisfy all of these cross-field rules:

- It contains `budget_minor`, a complete date pair, or both.
- `budget_minor` and every category limit are positive safe integers.
- `category_budgets_minor` is absent unless `budget_minor` exists, contains only persisted category keys, and contains at least one entry when present.
- `starts_on` and `ends_on` are both present or both absent, are real `YYYY-MM-DD` calendar dates, and `ends_on` is not before `starts_on`.
- `updated_by` is a valid normalized-login-equivalent string and `updated_at` is a valid UTC instant.
- Empty objects, explicit `null` fields, legacy presentation buckets, and unknown category keys are rejected. Removing a plan omits `spending_plan` entirely.

The post-CR canonical expense read model adds nullable metadata:

```ts
interface Expense {
  // All Phase 1 Expense fields remain unchanged.
  category: ExpenseCategory | null;
  payment_method: PaymentMethod | null;
}

type WritableExpense = Omit<Expense, 'category' | 'payment_method'> & {
  category: ExpenseCategory;
  payment_method: PaymentMethod;
};

interface ExpenseFile {
  expense: Expense;
  blobSha: string;
  path: `expenses/${string}.json`;
  // Added in CR-001 for lossless edits of forward-compatible fields.
  sourceDocument: Record<string, unknown>;
}
```

For a schema-version-1 expense, an absent `category` or `payment_method` normalizes to `null` and is the only route to the legacy buckets. A present unknown value, an explicit null, or a value of `uncategorized`/`unspecified` makes the expense invalid under the existing warning-and-exclusion rules. New creates and every successful edit serialize a `WritableExpense`; editing a legacy expense therefore requires both selections. Writers preserve both metadata fields and any unrelated passthrough fields during an edit.

`Just me` adds no persisted enum. It is exactly an equal split whose normalized participants contain only `paid_by`, whose `shares_minor` has only that same login, and whose share equals `amount_minor`. The draft helper is:

```ts
function applyJustMe(draft: ExpenseDraft, payer: string): ExpenseDraft {
  return {
    ...draft,
    paidBy: payer,
    splitType: 'equal',
    participants: [payer],
  };
}
```

The existing draft validator parses `draft.amount` into minor units and deterministically allocates the resulting full share to the sole participant. Any equal expense matching that persisted shape is classified as Just me, including one created without using the shortcut. It remains visible to all members and counts toward spending while contributing zero to every net balance.

### 16.3 Spending derivation and date arithmetic

Add one platform-free selector over the same validated expense array used by balance calculation:

```ts
interface SpendingSummary {
  totalSpentMinor: number;
  currentUserPaidMinor: number;
  currentUserShareMinor: number;
  categorySpentMinor: Record<CategoryBucket, number>;
  paymentMethodSpentMinor: Record<PaymentMethodBucket, number>;
  budget: null | {
    budgetMinor: number;
    remainingMinor: number;
    status: 'under' | 'at' | 'over';
    percentageUsed: number;
    categoryLimits: Partial<Record<ExpenseCategory, {
      limitMinor: number;
      spentMinor: number;
      remainingMinor: number;
      status: 'under' | 'at' | 'over';
      percentageUsed: number;
    }>>;
  };
  trip: null | {
    phase: 'before' | 'during' | 'after';
    totalDays: number;
    currentDay: number | null;
    availableDays: number;
    dailyAvailableMinor: number | null;
  };
}

function deriveSpendingSummary(
  expenses: readonly Expense[],
  plan: SpendingPlan | undefined,
  currentUser: string,
  today: CalendarDate,
): SpendingSummary;
```

The selector obeys these invariants:

1. `totalSpentMinor` sums every active, valid expense, including Just me and legacy expenses. Deleted files and invalid files are absent from its input.
2. Every expense enters exactly one category bucket and exactly one payment-method bucket, so each bucket record independently sums back to `totalSpentMinor`.
3. `currentUserPaidMinor` sums expenses whose normalized `paid_by` matches the account; `currentUserShareMinor` sums that login's persisted shares. These values are not inferred from net balance.
4. Uncategorized expenses count toward the total budget but cannot count against a persisted category limit. Category and payment-method changes leave allocation and `calculateBalances` output byte-for-byte equivalent.
5. All minor-unit addition is checked against `Number.MAX_SAFE_INTEGER`. An overflow returns a data-integrity warning instead of displaying rounded money.
6. Percentage is a non-persisted presentation ratio, may exceed 100, and is zero when its spent numerator is zero. The UI applies one shared rounding policy and also exposes exact money values, so progress bars are never the sole result.

For a budget, calculate `remainingMinor = budget_minor - totalSpentMinor`; classify positive, zero, and negative values as `under`, `at`, and `over`. Category-limit status uses the same rule. Budget state is informational and never participates in expense-form validation.

Date arithmetic must not construct stored trip dates at local midnight because daylight-saving transitions can make elapsed-millisecond division incorrect. Validate and convert each date's numeric components to a UTC day ordinal solely for inclusive whole-day subtraction. Supply `today` from a small injected device-local calendar boundary:

```ts
interface LocalCalendar {
  today(): CalendarDate; // local year, month, and day from the device clock
}
```

Before a trip, `availableDays` is the inclusive full trip length and the label is **Planned per day**. During it, `currentDay` and `availableDays` are inclusive. After it, `availableDays` is zero and no allowance is returned. When a budget and positive available-day count both exist, calculate `dailyAvailableMinor = Math.floor(Math.max(remainingMinor, 0) / availableDays)`; otherwise it is null. Dates without a budget still produce trip phase/context but no allowance. The Overview summary omits trip guidance when the selector returns no allowance and the Spending screen shows final under/over performance after the trip.

Combined filters are a pure predicate over the snapshot's expenses. Category, method, payer, and `all | shared | just_me` scopes compose with logical AND. `shared` means “not derived as Just me”; filters never change any aggregate unless a component is explicitly labelled as a filtered-result view.

### 16.4 GitHub gateway and optimistic concurrency

No new GitHub API family is required. Spending-plan writes use the Contents API on `group.json`, and expense writes keep using their existing files. Extend the product gateway boundary:

```ts
interface GitHubGateway {
  updateSpendingPlan(
    repository: RepositoryRef,
    current: GroupFile,
    next: SpendingPlan | null,
    signal?: AbortSignal,
  ): Promise<GroupFile>;
}
```

The operation merges only `spending_plan` into the validated passthrough `sourceDocument`, updates `updated_by`/`updated_at` from the authenticated account and injected clock, and serializes with the shared UTF-8/two-space/trailing-newline codec. A null plan deletes the property. Use commit message `Update spending plan` or `Remove spending plan`; never put budget amounts in commit messages.

Generate the audit fields once when submission begins and retain that intended plan across transport retries, just as expense creation retains its UUID. Form state never accepts member-supplied audit values.

The PUT includes `current.blobSha`. On a stale-SHA 409/422, fetch and parse the latest `group.json` and return:

```ts
type SpendingPlanConflict = {
  kind: 'spending_plan_conflict';
  latest: GroupFile;
  submitted: SpendingPlan | null;
};
```

The review screen displays the latest remote plan beside the member's unsaved submitted values. **Reapply** merges the submitted plan onto the latest passthrough document and uses its SHA; **Discard** accepts the remote file. Reapply must not overwrite concurrent changes to base group fields or unknown forward-compatible fields. There is no force-write action.

After a timeout or otherwise ambiguous response, read `group.json`: an exact semantic match of the intended plan is success; the unchanged base SHA is safe to retry; any other valid document enters conflict review. A missing or invalid `group.json` is a repository data error, not permission to recreate it. Any accepted member may submit, but GitHub remains the final permission check.

Complete group refresh now retains the `GroupFile` and SHA. Its derivation step computes balances, settlements, and `SpendingSummary` before one reducer commit. Invalid plan data contributes a warning and a missing runtime plan; invalid expense category or payment method excludes that expense from both balance and spending calculations, preserving the rule that all tabs use the same valid-file set.

### 16.5 Provider, snapshot, and cache impact

`GroupProvider` gains `updateSpendingPlan`/`removeSpendingPlan` actions and exposes spending selectors. Do not introduce a `SpendingProvider`: it would create a second resource lifecycle and allow Overview, Spending, and Balances to disagree.

`RemoteGroupSnapshot` and `GroupSnapshotV1` add:

- the validated `GroupFile`, including its latest SHA;
- the nullable/absent spending plan and safe plan warning;
- category and payment-method metadata on each normalized expense;
- the fully derived spending summary; and
- optional group-list budget progress derived from the same completed snapshot.

After a confirmed expense create/edit/delete, replace the expense file, then recompute balances, settlements, group summary, and spending summary synchronously before publishing and caching one new snapshot. After a confirmed plan update/removal, replace the group file and SHA, recompute spending against the unchanged expense array, and publish once. Neither path waits for a full refresh, and neither exposes a partially recomputed state.

CR-001 does not require an AsyncStorage key-version change. The `GroupSnapshotV1` cache decoder accepts Phase 1 records that lack group-file SHA, expense metadata, or derived spending fields, normalizes missing expense metadata to the legacy buckets, and recomputes all derivable summaries during hydration. A plan mutation remains disabled until a refresh supplies the latest `group.json` SHA. The next successful write stores the enriched snapshot. Cache data remains non-authoritative and can always be discarded.

`GroupsProvider` may cache budget progress per group and currency, but only from a complete selected-group snapshot. Discovery can detect a changed `group.json` SHA and mark that progress stale; it must not combine a freshly discovered budget with old expense totals and present the result as one synchronized generation. All-groups owed/owing aggregates remain currency-separated and unchanged.

### 16.6 Compatibility, security, and failure behavior

- Existing schema-version-1 groups without `spending_plan` load with no budget and no trip guidance.
- Existing schema-version-1 expenses without the two new keys remain valid, affect balances and total spending, and display explicit legacy labels.
- New clients continue to ignore unknown fields for calculations and preserve them when rewriting `group.json` or an expense, preventing CR-001 edits from destroying forward-compatible data.
- Category, payment method, and spending-plan fields are shared repository data. There is no private per-member budget or metadata store.
- `payment_method` is only the closed `card | cash | other` enum. Forms, domain types, logs, caches, fixtures, and analytics must not accept card suffixes, bank names, account identifiers, wallet credentials, or arbitrary payment-method notes.
- An invalid spending plan degrades only spending-plan features. An invalid present expense category/payment method excludes that expense everywhere, while an absent legacy field does not.
- Phase 1 clients can read CR-001 files because remote schema version stays at 1, but release builds predating passthrough preservation may remove new fields when they edit a file. Mixed-version editing must therefore be called out during rollout or prevented with a minimum-supported-client policy if such builds have shipped.

Add `spending_plan_conflict` to `AppError`. Retry semantics follow section 16.4; a generic retry must never silently apply submitted values to a newly fetched SHA. Network, timeout, rate-limit, permission, and access-loss behavior otherwise reuses the Phase 1 error model.

### 16.7 CR-001 test architecture

Extend the platform-free unit suite with table-driven coverage for:

- every category and payment-method value, absent legacy keys, explicit null, unknown values, and writer requirements;
- valid and invalid spending-plan combinations, safe-integer limits, category keys, empty removal, and inclusive date ranges;
- total/category/method aggregation reconciliation, current-user paid/share totals, Just me classification, and checked-sum overflow;
- under/at/over budget and category-limit status, percentage policy, and the invariant that metadata-only edits do not alter balances or settlements;
- local-calendar trip phases, leap days, month/year boundaries, daylight-saving dates, inclusive day counts, post-trip behavior, and floor rounding of the non-negative daily allowance; and
- logically ANDed category/method/payer/scope filters and empty results.

Service/integration tests use the existing scripted GitHub transport, fake clock, `LocalCalendar`, and in-memory cache to cover:

- refreshes with no plan, a valid plan, an invalid plan warning, mixed legacy/CR expenses, and identical valid-file input for balance and spending selectors;
- create/update/remove plan writes, passthrough preservation, returned SHA replacement, ambiguous-success recovery, 409/422 conflict review, reapply on the latest document, and discard;
- CR expense create/edit, mandatory migration of legacy fields on edit, immediate recomputation after create/edit/delete, and a plan update racing a remote group change;
- hydration of a Phase 1 cache followed by remote refresh, missing cached group SHA blocking writes, and stale group-list budget progress; and
- coalesced refreshes across all four tabs with no Spending-specific request.

Component/navigation tests cover the four-tab layout, compact Overview summary, no-budget and no-expense states, spending-plan form permissions and validation, textual under/over states, accessible category/payment controls, payer changes in a Just me draft, legacy labels, combined filters, and conflict review preserving unsaved input.

Extend the physical two-account Android acceptance run exactly as required by PRD section 16.14: configure budget and trip dates, record card and cash expenses across categories, add Just me spending, exceed a category limit, force a concurrent plan conflict, and verify identical totals after refresh on both devices. Also verify that no payment UI requests identifying financial data.

### 16.8 Post-Phase-1 implementation sequence

Implement CR-001 only after the Phase 1 stages in section 14 are green:

1. **Schema and domain delta:** taxonomy constants, two-stage group parsing, legacy-compatible expense parsing, strict writable expense type, plan invariants, Just me helper/classifier, spending/date/filter selectors, and unit tests.
2. **GitHub write path:** retain `GroupFile` SHA/source document, add plan update/removal with ambiguous-write recovery and conflict review, preserve passthrough fields, and add service tests.
3. **Atomic state and cache:** enrich snapshots, derive summaries on hydration/refresh/mutation, expose `GroupProvider` plan actions/selectors, add stale group-list progress rules, and test Phase 1 cache compatibility.
4. **Expense experience:** add category, payment method, and Just me controls to the shared form; update list/detail metadata and legacy presentation; verify balance invariance.
5. **Spending experience:** add the fourth tab, plan editor, Overview card, category/method/limit summaries, trip guidance, combined filters, accessibility text, and explicit empty/error states.
6. **Hardening and acceptance:** conflict/race tests, time-boundary tests, accessibility pass, two-account physical-device scenario, and the existing typecheck/lint/test/doctor/APK gates.

Custom categories, recurring budgets, planned expenses, cash wallets, automatic categorization, transaction import, receipt processing, notifications, multi-currency conversion, offline writes, and hidden per-user plans remain outside this increment.
