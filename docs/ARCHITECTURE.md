# BranchBalance — Phase 1 Architecture and CR-001/CR-002/CR-003/CR-004/CR-005 Increments + CR-006 Proposal

**Status:** Phase 1 implementation guide; CR-001 through CR-005 implemented; CR-006 proposed and not authorized for implementation; CR-003 physical-device acceptance blocked by a known GitHub App token limitation and CR-004/CR-005 physical-device acceptance pending
**Applies to:** Phase 1 Android application, CR-001 trip and group spending intelligence, CR-002 settlement payment recording, CR-003 in-app group invitation decisions, CR-004 on-device activity inbox, CR-005 pace, mix, and fairness analytics, and the proposed CR-006 private on-device receipt-scanning architecture
**Companion specification:** [`PRD.md`](PRD.md)
**Last updated:** 2026-07-20

## 1. Purpose and decision precedence

This document turns the Phase 1 product requirements and the screens in `mockups/` into an implementation blueprint. Together with the PRD, the implemented increments are intended to be sufficient to implement, test, and package the application without making additional architectural decisions. CR-006 is deliberately different: section 21 records the proposed boundaries and the decisions that must pass review before implementation is authorized.

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
| Receipt scanning | CR-006 is a proposed local-only prefill path. It does not save expenses automatically, retain receipt content, or authorize implementation before the section 21.13 gates pass. |

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

Before sending an invitation, trim and normalize the entered login and reject the repository owner, an accepted member, or a login already present in pending invitations. Revalidate against a refreshed member snapshot before a retry. Map unknown-user, permission, and invitation rate-limit failures to plain-language typed errors. After GitHub confirms the write, the Members screen owns an ephemeral polite live-region notice that names the invited login and repository, directs the invitee to accept at `github.com`, and tells them to refresh **Your groups** afterward. Do not show this success notice for a rejected or ambiguous invitation write.

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

The Spending tab does not fetch on its own. Tab focus requests the same coalesced `GroupProvider.refresh()` used by the other selected-group screens. For the initial CR-001 increment, charts are optional leaf presentation components; CR-005 later makes the focused Pace, Mix, and Fairness analytics components required. Accessible text values remain the authoritative UI and must be available when charts are absent or visually unsuitable.

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

## 17. CR-002 architecture delta — Settlement payment recording

CR-001 and CR-002 are implemented. Section 15 remains the Phase 1 completion boundary, while this section records the additive architecture delivered for PRD change request CR-002. Unless explicitly changed below, every Phase 1 and CR-001 decision remains in force: GitHub is authoritative, writes are online-only, one group has one currency, money uses integer minor units, expenses remain separate files, and spending metadata never affects balances.

### 17.1 Source, navigation, and ownership

Add a platform-free settlement domain under `src/domain/settlements/` and settlement form/use-case code under `src/features/settlements/`. The domain may import shared money, login, date, and balance types but imports neither React Native nor GitHub infrastructure.

The selected-group stack adds a pushed `settlements/new` route opened only from a current suggestion. Normalized sender and recipient route parameters identify the suggestion to reopen from the live `GroupProvider` snapshot; no amount passed through navigation is authoritative. The route derives the unreserved maximum after pending payments. If the pair has no remaining availability, it shows a stale or Awaiting confirmation state and returns to Balances.

The existing **Balances** tab owns:

- expense-paid, expense-share, confirmed-settlement-sent, confirmed-settlement-received, and adjusted net totals;
- current deterministic suggestions, pending reservations, and Record payment actions;
- pending recipient-confirmation actions, complete payment history, and delete confirmations; and
- ledger warnings, empty states, stale-draft recovery, and accessible success announcements.

Overview may consume the adjusted quick-settlement selector. Spending continues to consume expense-only inputs. Do not add a `SettlementProvider`, independent refresh path, financial SDK, database, decimal library, or background service. `GroupProvider` remains the single owner of the selected repository generation.

### 17.2 Persisted and runtime types

CR-002 renames the existing derived `Settlement` concept to `SuggestedSettlement` so recorded facts and calculated advice cannot be confused:

```ts
interface SuggestedSettlement {
  from: string;
  to: string;
  amountMinor: number;
}

interface SettlementPayment {
  id: string;
  from: string;
  to: string;
  amount_minor: number;
  currency: CurrencyCode;
  paid_on: CalendarDate;
  note?: string;
  status: 'pending' | 'confirmed';
  recorded_by: string;
  recorded_at: IsoInstant;
  confirmed_by: string | null;
  confirmed_at: IsoInstant | null;
}

interface SettlementReservation {
  from: string;
  to: string;
  pendingMinor: number;
  availableToRecordMinor: number;
}

interface SettlementLedgerFile {
  payments: SettlementPayment[];
  blobSha: string;
  path: 'settlements.json';
  // Full validated-passthrough document retained for lossless rewrites.
  sourceDocument: Record<string, unknown>;
}

type SettlementLedgerState =
  | { kind: 'unverified' }
  | { kind: 'missing'; payments: [] }
  | { kind: 'ready'; file: SettlementLedgerFile }
  | { kind: 'invalid'; warning: DataWarning };
```

`unverified` exists only for legacy cache hydration and disables mutation until remote refresh. `missing` means GitHub has confirmed a 404 for `settlements.json`; it is the only state that permits a create-without-SHA operation. `ready` permits SHA-protected append and delete. `invalid` contributes no payments and blocks mutation rather than overwriting data the app cannot safely preserve.

Parse the ledger in two stages. First validate the top-level passthrough object, `schema_version: 1`, and a `payments` array. Then parse entries independently against the PRD invariants, including note length and the pending/confirmed audit-field relationships. Retain the complete source array, including invalid entries and unknown fields, while exposing only valid normalized records to calculations.

Duplicate IDs are unsafe for recovery, confirmation, and deletion. Count IDs before entry parsing and exclude every occurrence of a duplicated ID with a warning. Preserve display logins as recorded, use `normalizeLogin` for identity comparison, require distinct normalized `from` and `to`, and require `currency` to equal the loaded group. A pending record requires null confirmation fields. A confirmed record requires `confirmed_by` to normalize to `to` and `confirmed_at` to be a valid UTC instant not earlier than `recorded_at`. Readers validate `paid_on` as a calendar date without comparing it to today's date; the create use case separately rejects future dates at submission.

Normalize an absent note to `undefined`; a present note must already be trimmed, contain 1–2,000 Unicode characters, and remain plain text. Do not parse Markdown, linkify URLs, or extract financial identifiers. The entire note remains shared opaque content for display and confirmation only.

Sort valid payment history by `paid_on` descending, then `recorded_at` descending, then normalized `id` ascending. Ledger array order never affects balances, recovery, or presentation.

### 17.3 Balance derivation and validation

Extend the existing pure balance boundary:

```ts
interface MemberBalance {
  login: string;
  totalPaidMinor: number;          // expenses paid
  totalShareMinor: number;         // expense shares
  settlementSentMinor: number;     // confirmed transfers sent
  settlementReceivedMinor: number; // confirmed transfers received
  netMinor: number;                // expenses plus confirmed settlements
  currentMember: boolean;
}

function calculateBalances(
  expenses: readonly Expense[],
  payments: readonly SettlementPayment[],
  currentMembers: readonly Member[],
): BalanceResult;

function simplifySettlements(balances: readonly MemberBalance[]): SuggestedSettlement[];
function deriveSettlementReservations(
  suggestions: readonly SuggestedSettlement[],
  payments: readonly SettlementPayment[],
): SettlementReservation[];
```

Seed identities from current members, every expense login, and `from` and `to` logins in valid payments. Expense accumulation remains unchanged. Ignore pending payments for balance arithmetic. For each confirmed payment, checked-add `amount_minor` to the sender's `settlementSentMinor` and `netMinor`, and checked-add it to the recipient's `settlementReceivedMinor` while subtracting it from their `netMinor`. Use checked safe-integer operations throughout; overflow yields no suggestions and a data-integrity warning.

`totalSpentMinor`, `totalPaidMinor`, and `totalShareMinor` remain expense-only. `deriveSpendingSummary` continues to receive only valid expenses and is byte-for-byte independent of the settlement ledger. The sum of all `netMinor` values must remain zero after every valid confirmed payment; otherwise suppress suggestions and surface the existing integrity warning.

Run `simplifySettlements` only after all valid confirmed payments have adjusted the net rows. It keeps the existing largest-debtor/largest-creditor algorithm and normalized-login tie breaks.

`deriveSettlementReservations` groups pending payments by normalized `from`/`to`, checked-sums `pendingMinor`, and joins them to the derived suggestion pair. `availableToRecordMinor` is `max(suggestion.amountMinor - pendingMinor, 0)`. Orphaned or excessive pending records caused by later expense changes remain visible but cannot make availability negative or change net balances.

The create use case validates against the exact `SuggestedSettlement` set derived from the refreshed expense generation and current valid ledger:

```ts
function validateSettlementDraft(
  draft: SettlementPaymentDraft,
  suggestions: readonly SuggestedSettlement[],
  reservations: readonly SettlementReservation[],
  currency: CurrencyCode,
  today: CalendarDate,
): ValidSettlementPaymentInput;
```

Match `from` and `to` case-insensitively, require a current matching suggestion, and cap the parsed positive amount at its `availableToRecordMinor`. Trim and validate the optional note without interpreting its content. Build the final UUID and recording timestamp once when submission begins, force `status: 'pending'` with null confirmation fields, and reuse the intended record across every transport retry. A later expense mutation may change the resulting debt direction but does not retroactively invalidate a recipient-confirmed payment.

### 17.4 GitHub gateway and optimistic concurrency

No new GitHub API family is required. Read and write `settlements.json` through the Contents API on the repository's reported default branch. Extend the product gateway boundary with operations equivalent to:

```ts
interface GitHubGateway {
  readSettlementLedger(
    repository: RepositoryRef,
    currency: CurrencyCode,
    signal?: AbortSignal,
  ): Promise<SettlementLedgerState>;
  recordSettlementPayment(
    repository: RepositoryRef,
    current: SettlementLedgerState,
    intended: SettlementPayment,
    basis: SettlementValidationBasis,
    signal?: AbortSignal,
  ): Promise<SettlementLedgerFile>;
  confirmSettlementPayment(
    repository: RepositoryRef,
    current: SettlementLedgerFile,
    paymentId: string,
    recipient: string,
    confirmedAt: IsoInstant,
    signal?: AbortSignal,
  ): Promise<SettlementLedgerFile>;
  deleteSettlementPayment(
    repository: RepositoryRef,
    current: SettlementLedgerFile,
    paymentId: string,
    signal?: AbortSignal,
  ): Promise<SettlementLedgerState>;
}
```

A complete group refresh reads repository metadata, `group.json`, collaborators, invitations, the expense tree, and `settlements.json` as one coalesced operation. A not-found response for only the ledger maps to `missing`; permission, rate-limit, network, and malformed-content failures retain their existing distinct error behavior.

For the first append, serialize `{ schema_version: 1, payments: [intended] }` with the shared UTF-8, two-space, trailing-newline codec and omit `sha`. For later appends, clone the passthrough source document, append the intended pending record to its existing source array, and include `blobSha`. Use commit message `Record settlement payment <uuid>`; do not put member names, dates, amounts, notes, or confirmation state in commit messages.

A 409/422 during a missing-file create or SHA-protected append triggers a ledger reread. Reparse valid entries, apply confirmed payments, derive suggestions and pending reservations against the submission's refreshed expense basis, and:

- return success if the intended UUID has the same immutable creation fields and is either still pending or validly confirmed;
- retry with the latest SHA when the UUID is absent and the requested pair and amount remain within the unreserved availability;
- return `settlement_stale` with the latest available amount or zero when another pending or confirmed payment consumed the availability; or
- return `settlement_record_conflict` when the UUID exists with different semantic content.

There is no force append. Permit at most one automatic merge retry per observed SHA; a second changing SHA returns a retryable stale state to avoid an unbounded loop.

On timeout or another ambiguous response, reread the ledger before exposing failure. Matching immutable creation content in a pending or validly confirmed record is success; the unchanged prior state is safe for one retry; a changed state follows the same merge rules. Never regenerate the UUID during recovery.

Confirmation is a SHA-protected transform of exactly one source entry. Before writing, require the authenticated account to be a current accepted write-enabled member whose normalized login equals the pending record's `to`. Preserve every immutable field, including `note`; change only `status` to `confirmed`, set `confirmed_by` from that recipient, and set `confirmed_at` once from the injected UTC clock. Use `Confirm settlement payment <uuid>` without sensitive content in the commit message.

A stale-SHA confirmation rereads the ledger. The same record still pending is safe for one bounded retry using the original `confirmedAt`. The same immutable record already confirmed by the same recipient is idempotent success, regardless of a different remote confirmation timestamp. An absent record, changed immutable content, a different confirmer, or malformed/duplicated ID returns `settlement_confirmation_conflict`; there is no force confirmation. Confirmation does not revalidate the suggestion amount because receipt is an attested historical fact.

Deletion clones the latest passthrough document and removes exactly one valid record with the requested UUID, preserving every other valid or invalid source entry and unknown field. Use `Delete settlement payment <uuid>`. A stale SHA rereads and retries against the latest source; an absent ID is idempotent success. A same-ID malformed or duplicated source entry is not silently removed and instead returns a ledger data error.

If deletion removes the last valid payment, retain a valid empty `settlements.json` rather than deleting the file. This avoids a delete-versus-first-create race and preserves forward-compatible top-level data.

Add typed `settlement_stale`, `settlement_record_conflict`, `settlement_confirmation_conflict`, and `settlement_ledger_invalid` cases to `AppError`. Treat a non-recipient confirmation attempt as a domain authorization error before transport. Map network, timeout, rate-limit, permission, and access loss through the existing error model. A generic retry must never bypass reservation validation, change note content, create a second semantic payment, or confirm on behalf of another login.

### 17.5 Provider, snapshot, and cache impact

`RemoteGroupSnapshot` adds the full ledger state, deterministically sorted valid pending/confirmed history, reservations, adjusted balance result, and `SuggestedSettlement[]`. `GroupSnapshotV1` stores only the non-sensitive payment core needed to reconstruct confirmed balances and pending reservations; it excludes `note`, the passthrough source document, and all unknown ledger content. Spending data remains unchanged. The group summary's current-user balance uses confirmed payments only so the group list and selected group agree after receipt confirmation.

Remote refresh derives these values in order before one reducer commit:

1. Parse the group, members, expenses, and ledger.
2. Calculate expense balances adjusted by valid confirmed payments.
3. Verify zero-sum integrity, derive suggestions, and derive pending reservations/availability.
4. Derive spending from the same expense array without any payments.
5. Publish balances, suggestions, reservations, pending/confirmed history, spending, and warnings together.

`GroupProvider` gains `recordSettlementPayment`, `confirmSettlementPayment`, and `deleteSettlementPayment` actions. A GitHub-confirmed create replaces the ledger, recomputes reservations without changing balances, and publishes once. A recipient confirmation or confirmed-record deletion recomputes balances, suggestions, reservations, and group summary; a pending-record deletion recomputes reservations only. Every operation publishes one internally consistent snapshot without waiting for full refresh. `GroupsProvider` records the confirmed ledger generation so an older in-flight refresh cannot overwrite current reservations or adjusted balance.

CR-002 does not require an AsyncStorage key-version change. Every cached ledger hydrates as `unverified` because the SHA/source document and sensitive note content are deliberately absent; cached core fields may reconstruct provisional adjusted balances and reservations while the UI marks them refreshing/stale. Record, Confirm received, Delete, and note display remain disabled until remote refresh establishes `missing`, `ready`, or `invalid` and supplies the full in-memory ledger. Phase 1/CR-001 caches without settlement fields hydrate as an unverified empty ledger.

Before every cache write, map payments to the explicit redacted cache DTO rather than serializing `RemoteGroupSnapshot`. If cache persistence fails after GitHub confirms a mutation, retain the complete in-memory remote snapshot and show the existing non-destructive cache warning. Cache content remains non-authoritative and discardable.

### 17.6 UI, permissions, and accessibility

Each suggested-settlement card receives one **Record payment** button when `repository.canWrite` is true, the ledger is verified and mutable, and `availableToRecordMinor` is positive. The card shows total suggested debt, pending reservation, and unreserved availability separately. The pushed form resolves the live suggestion by normalized pair, shows sender and recipient read-only, preloads the unreserved maximum, accepts the existing money input and native calendar-date control plus an optional multiline note, and presents one review confirmation before creating the pending record.

Any accepted write-enabled member can record a suggestion on behalf of its sender; the authenticated member need not equal `from` or `to`. The UI states that BranchBalance records a transfer completed elsewhere, creates a pending claim, and does not move money. `recorded_by` makes that delegation auditable.

The form focuses the first invalid field, preserves amount, date, and note after transport or stale errors, updates the maximum after a stale response, prevents duplicate taps, and announces that confirmation is pending. A non-empty note triggers a shared-sensitive-data warning before submission. If the pair disappears or is fully reserved, the form offers return to Balances rather than arbitrary recipient selection.

Pending rows expose **Confirm received** only when the authenticated normalized login equals `to` and repository write access is current. Confirmation displays immutable transfer fields and the complete note, asks the recipient to attest receipt, and never allows edits. Other members see who must confirm. A confirmed result announces the adjusted remaining debt.

Payment history rows expose status, sender, recipient, formatted amount, payment date, full plain-text note, recording audit, and confirmation audit to accessibility services. URLs in notes are selectable text but never automatic links. Delete uses the shared confirmation dialog and is disabled while the ledger is unverified or invalid. Money direction and status are stated in text and never communicated only by colour or iconography.

An empty verified ledger shows **No payments recorded**. A fully reserved suggestion shows **Awaiting confirmation**, not All settled. **All settled** requires both zero adjusted suggestions and zero pending reservations while retaining history. A malformed ledger shows a data-warning banner, expense-only spending remains available, suggestions are suppressed because the adjusted balance is unknown, and mutation stays disabled.

### 17.7 Compatibility, security, and operational limits

- A missing ledger is the backward-compatible empty state; group and expense schema versions remain unchanged.
- Pre-CR-002 clients ignore `settlements.json` and therefore show expense-only balances. Once any payment is recorded, rollout must require or clearly coordinate upgrade of every active group member; old and new clients cannot be expected to display the same net balance.
- Old clients cannot destroy the ledger when editing expenses or `group.json` because it is a separate file.
- Settlement metadata, including notes, is shared private-repository data and is not end-to-end encrypted by BranchBalance. There is no private payment history.
- Notes may contain plain-text receipt or attachment references, external transaction IDs, bank names, or financial-account identifiers. They are stored only in the remote ledger and current in-memory snapshot; exclude them from AsyncStorage caches, logs, analytics, telemetry, errors, crash reports, notifications, and commit messages.
- Before saving a note, warn that all repository members and Git history may retain it. Tell users never to enter passwords, PINs, CVVs, access/refresh tokens, recovery codes, signing keys, or other authentication secrets.
- Treat note text as opaque untrusted content: trim and length-check it, render it as plain text, do not linkify or execute it, and never include it in an error interpolation.
- CR-002 uploads no binary receipt or attachment and creates no structured external-transaction or account field. Those may be described or referenced only inside `note`.
- `from` and `to` describe a reported transfer. Current repository write permission authorizes creation/deletion, while confirmation additionally requires the authenticated normalized login to equal the current accepted recipient.
- Recording and confirmation IDs/timestamps are generated once by trusted boundaries and all logs redact private file bodies.
- Never truncate a ledger to satisfy a GitHub size failure. Check the serialized payload before upload and return a safe ledger-capacity error if it exceeds the Contents API limit; archival or sharding requires a later change request because it affects the concurrency boundary.
- Invalid entries are isolated for reads but preserved during safe rewrites. An invalid top-level document blocks writes so the app never replaces unknown repository data with an empty ledger.

### 17.8 CR-002 test architecture

Extend the platform-free unit suite with table-driven coverage for:

- missing, empty, valid, partially invalid, malformed, forward-compatible, duplicate-ID, wrong-currency, same-party, unsafe-amount, and invalid pending/confirmed ledger inputs;
- note omission/trimming/length, opaque plain-text handling, writer-only future-date rejection, and time-independent parsing of persisted calendar dates;
- expense-only totals plus zero, full, partial, chained, historical-member confirmed payments, and balance-neutral pending payments;
- checked arithmetic, zero-sum preservation, deterministic suggestions/history, pending reservation availability, and unchanged spending summaries;
- exact pair matching, normalized-login matching, unreserved-amount rejection, recipient-only/idempotent confirmation, and debt reversal after a later expense mutation; and
- lossless append/confirm/delete source transforms that retain notes, unknown fields, and unrelated invalid entries.

Service/integration tests use the scripted GitHub transport, fake clock, ID generator, local calendar, and in-memory cache to cover:

- group refresh with every ledger state and atomic derivation of pending/confirmed history, adjusted balances, reservations, suggestions, warnings, and expense-only spending;
- first pending create, note preservation, normal SHA append, returned SHA replacement, capacity failure, and permission errors;
- recipient confirmation, non-recipient rejection, stale-SHA retry, idempotent already-confirmed success, confirmation conflict, and immutable note preservation;
- concurrent append that remains within availability, stale over-reservation rejection, concurrent missing-file creation, bounded retry, and UUID collision;
- ambiguous create/confirm success, unchanged-state retry, and proof that retry never changes UUID or audit timestamps;
- pending/confirmed delete, stale-SHA delete, already-absent success, ambiguous delete, empty-ledger retention, and malformed-ID refusal;
- an expense mutation racing a payment mutation followed by one internally consistent remote refresh; and
- Phase 1/CR-001 cache hydration with disabled writes, redacted payment-core hydration, proof that notes/source documents never persist locally, confirmed-mutation reconciliation, and cache-write failure.

Component/navigation tests cover action visibility, live route resolution, fixed sender/recipient, full/partial amount entry, past/default/future dates, note limits and sensitive-data warning, plain-text rendering without active links, pending creation, recipient-only confirmation, duplicate-submit prevention, stale availability recovery, accessible status, history ordering, pending/confirmed deletion, warnings, no-history, Awaiting confirmation, and All settled with retained history.

Extend the physical two-account Android acceptance run exactly as required by PRD section 17.12: create and synchronize a partial pending payment with a sensitive-data warning and note, verify unchanged balances plus reduced availability, confirm as the recipient, record/confirm the remainder, delete a payment, and verify expense/spending totals remain unchanged. Race two devices against one suggestion so only the unreserved amount can commit, and verify a non-recipient cannot confirm.

### 17.9 Post-v1.0.0 implementation sequence

CR-002 was implemented after the existing Phase 1 and CR-001 validation gates were green, in this order:

1. **Schema and domain delta:** ledger parser, pending/confirmed cross-field validation, optional note, per-entry warnings, payment/history/reservation types, confirmed-only balance derivation, suggestion rename, lossless transforms, and unit tests.
2. **GitHub ledger path:** verified missing/read states, pending create, SHA append/confirm/delete, recipient authorization, bounded merge, ambiguous-write recovery, typed errors, payload-size guard, and service tests.
3. **Atomic state and cache:** enrich remote snapshots, persist only redacted payment core, hydrate all caches as unverified, reconcile create/confirm/delete generations, update adjusted group summaries, and test stale-refresh races.
4. **Balances experience:** add Record payment navigation/form/note warning, pending reservations, recipient confirmation, confirmed settlement totals, status/history/deletion, warning/empty/stale states, and accessibility announcements.
5. **Hardening and acceptance:** concurrency, corruption, capacity, permission, accessibility, two-account physical-device coverage, and the existing typecheck/lint/test/doctor/APK gates.

Payment-provider integrations, arbitrary or excessive transfers, record editing, per-expense allocation, binary receipt/attachment uploads, structured transaction/account fields outside the optional note, recurring payments, reminders, offline writes, and ledger archival remain outside this increment.

## 18. CR-003 architecture delta — In-app group invitation decisions

CR-003 is implemented; physical two-account Android acceptance remains pending. This section defines the additive architecture delivered for PRD change request CR-003; Phase 1, CR-001, and CR-002 behavior remains in force unless explicitly changed below. GitHub remains authoritative for invitations and repository access. The increment adds no BranchBalance backend, repository document, background task, persistent invitation cache, or new runtime dependency.

The selected-group `PendingMember` model and `GroupProvider` continue to serve the repository owner's view of invitations sent from one accepted group. CR-003 adds a separate `PendingGroupInvitation` model for invitations received by the authenticated user before that user can open the repository. These concepts must not share state or be treated as interchangeable.

### 18.1 Ownership, source organization, and navigation

The top-level `GroupsProvider` owns invitee-side invitation state because the invitation is account-scoped and no valid selected-group route exists before acceptance. Do not add an `InvitationsProvider` or place received invitations in `GroupProvider`.

Add a narrow feature boundary:

```text
src/
├── domain/
│   └── types.ts                         # PendingGroupInvitation transport-independent types
├── features/
│   └── invitations/
│       ├── eligibility.ts               # validate/filter/order/provisional naming
│       └── reconciliation.ts            # classify post-decision GitHub state
├── infrastructure/
│   └── github/
│       ├── contracts.ts                 # invitation gateway operations
│       └── gateway.ts                   # Octokit DTO mapping and pagination
├── providers/
│   └── groups-provider.tsx              # dashboard refresh and decision actions
└── app/(app)/groups/
    └── index.tsx                        # Invited groups section
```

No new route is required. `/(app)/groups` composes the existing account heading, currency-separated aggregate summary, **Create a group**, the conditional **Invited groups** section, and accepted group cards in that order. An invitation card is not a group link and must not construct or navigate to `/groups/[owner]/[repo]` until accepted discovery returns a valid `DiscoveredGroup`.

The shared confirmation-dialog, button, banner, pill, live-region, and retry primitives are sufficient. Native implementation follows the CR-003 update to mockup 03; the mockup's browser script is presentation guidance and is not application state logic.

### 18.2 Domain and transport-independent types

Add explicit types rather than passing Octokit invitation responses into React:

```ts
type GroupInvitationPermission = 'write' | 'maintain' | 'admin';

interface PendingGroupInvitation {
  id: number;
  repository: {
    id: number;
    owner: string;
    ownerType: 'User';
    name: string;
    fullName: string;
    private: true;
  };
  invitee: string;
  inviter: string;
  permission: GroupInvitationPermission;
  createdAt: IsoInstant;
  provisionalName: string;
}

interface InvitationDiscoveryResult {
  invitations: PendingGroupInvitation[];
  warnings: DataWarning[];
}

interface AcceptedInvitationPendingDiscovery {
  invitationId: number;
  repositoryId: number;
  repositoryFullName: string;
  provisionalName: string;
  acceptedAt: IsoInstant;
  reason: 'not_loadable' | 'discovery_failed';
}
```

`PendingGroupInvitation` is ephemeral GitHub metadata, not a repository-backed entity. It has no `GroupKey`, `Group`, `GroupFile`, balance, members, expenses, spending, or settlement data. `provisionalName` is presentation-only and must never be persisted or later preferred over the validated `group.json` name.

Validate the selected transport fields before constructing the type:

- `id` and repository `id` are positive safe integers;
- repository owner, repository name/full name, invitee, and inviter are non-empty normalized GitHub identities or names;
- repository privacy is `true` and owner type is `User`;
- repository name begins with `branch-balance-`;
- normalized invitee equals the current authenticated login;
- permission ranks at least `write`; and
- `created_at` is a valid instant.

The permission rank is `read < triage < write < maintain < admin`; only the final three map into `GroupInvitationPermission`. Reject malformed or ineligible entries independently and record safe warnings without exposing raw response bodies. Deduplicate by invitation ID, then sort newest `createdAt` first, case-insensitive repository full name second, and ID third. A duplicate ID with semantically different repository data is excluded with a warning instead of choosing one record arbitrarily.

Derive the provisional name by removing exactly one leading `branch-balance-`, replacing internal hyphen runs with spaces, trimming, and applying presentation capitalization. If that produces an empty label, fall back to the repository name. This derivation never proves that the repository is a BranchBalance group.

### 18.3 GitHub gateway contract and endpoint behavior

Extend the product gateway boundary:

```ts
interface GitHubGateway {
  listGroupInvitations(
    currentLogin: string,
    signal?: AbortSignal,
  ): Promise<InvitationDiscoveryResult>;
  acceptGroupInvitation(
    invitationId: number,
    signal?: AbortSignal,
  ): Promise<void>;
  declineGroupInvitation(
    invitationId: number,
    signal?: AbortSignal,
  ): Promise<void>;
}
```

The gateway uses the authenticated GitHub App user token and the shared media type and pinned API version:

| Operation | REST endpoint |
|---|---|
| List open invitations for the current user | `GET /user/repository_invitations` |
| Accept an invitation | `PATCH /user/repository_invitations/{invitation_id}` |
| Decline an invitation | `DELETE /user/repository_invitations/{invitation_id}` |

`listGroupInvitations` follows pagination to completion before returning one deterministic result. Validate and map one page at a time, but publish only after every page succeeds; a partial page set must never be presented as the authoritative list. The gateway does not request `group.json` or any repository contents while the invitation is pending because repository access has not been accepted.

The existing GitHub App **Administration: read and write** repository permission is the documented permission for these user-token operations. Permission failure maps through the shared typed error model with an invitation-specific operation label. If the installed app or current user authorization lacks the required permission, expose reauthorization guidance rather than converting `403` into an empty list.

Physical-device testing identified a separate GitHub App user-token visibility limitation: `GET /user/repository_invitations` returned `200 OK`, an empty array, and `X-Accepted-GitHub-Permissions: administration=read` while the authenticated account had a pending private-repository invitation visible on GitHub. This response is indistinguishable from a genuine empty invitation list at the API boundary. It is consistent with GitHub's rule that a user access token can access only resources available to both the user and app; the invitee does not have repository access until the invitation is accepted. Do not represent additional repository permissions as a fix for this case.

The account-level **Private repository invitations: read** permission may be tested as a compatibility experiment, but it is not a confirmed requirement for this endpoint. If it does not change the response, resolving pre-acceptance discovery requires an architecture decision between targeted OAuth `repo:invite` authorization and a backend/owner-mediated invitation handoff. Until then, the operational fallback is acceptance through GitHub followed by normal BranchBalance group discovery. The work is tracked in [`ROADMAP.md`](../ROADMAP.md#reliable-pre-acceptance-private-invitation-discovery).

Accept and decline send no request body and require a positive invitation ID. A `204` is a confirmed GitHub decision. Do not automatically replay a decision after timeout, connection loss, `404`, `409`, or another ambiguous result; first run the reconciliation algorithm in section 18.5. The authenticated client's existing one-time replay after an explicit `401` may remain because GitHub rejected the unauthenticated request before normal operation handling.

Map rate limits, network failure, timeout, and terminal authentication through the shared client. Add invitation-specific safe classification where needed:

```ts
type InvitationDecisionError =
  | { kind: 'invitation_unavailable'; invitationId: number }
  | { kind: 'invitation_decision_unknown'; invitationId: number; action: 'accept' | 'decline' }
  | { kind: 'invitation_permission'; operation: 'list' | 'accept' | 'decline' };
```

These errors contain IDs and safe operation names only. Repository full names, inviter logins, private response bodies, authorization headers, and tokens stay out of errors, logs, analytics, and crash reports.

### 18.4 GroupsProvider state and dashboard refresh

Keep accepted groups and received invitations as separate resources so either result can succeed while the other fails:

```ts
interface GroupsContextValue {
  state: ResourceState<DiscoveredGroup[]>; // existing accepted groups
  invitationState: ResourceState<PendingGroupInvitation[]>;
  invitationMutations: ReadonlyMap<number, 'accepting' | 'declining'>;
  acceptedPendingDiscovery: readonly AcceptedInvitationPendingDiscovery[];
  refresh(): Promise<void>;
  acceptInvitation(invitationId: number): Promise<void>;
  declineInvitation(invitationId: number): Promise<void>;
  // Existing creation, summary, and mutation-reconciliation members remain.
}
```

`GroupsProvider.refresh()` becomes a dashboard refresh with one provider-instance in-flight promise. It starts accepted-group discovery and invitation discovery together and observes them with `Promise.allSettled` semantics:

1. Terminal authentication failure from either branch expires the session and clears both resources.
2. A successful group result replaces only accepted-group descriptors and persists the existing groups cache.
3. A failed group result preserves cached/in-memory accepted groups and sets the existing scoped error.
4. A successful invitation result replaces only in-memory invitations and their timestamp.
5. A failed invitation result preserves the last in-memory invitation list, marks it stale, and sets an invitation-scoped error.
6. Pull-to-refresh ends after both branches settle and exposes separate retry copy where only one failed.

Launch, group-list focus, foreground, explicit retry, and pull-to-refresh all call this same method. Concurrent lifecycle triggers join its current promise. Foreground refresh remains limited to the visible resource; it does not refresh every accepted group's contents.

Invitation cards from a stale failed refresh remain visible for context but their decision actions are disabled until a successful invitation reconciliation confirms that their IDs are still open. Accepted group cards remain fully usable when only invitation discovery fails. A first-load invitation failure shows a scoped banner without inventing an empty authoritative invitation list.

`invitationMutations` is keyed by invitation ID. Inserting the ID is atomic before the gateway call, so repeated taps join or ignore the existing operation and cannot send duplicate mutations. A mutation disables only its own card. Sign-out, terminal session expiry, or account change clears invitation data, mutation state, confirmed-decision barriers, and accepted-pending-discovery state.

### 18.5 Decision mutations and reconciliation

Invitation decisions do not use optimistic repository membership. They use a confirmed-decision barrier plus a fresh post-mutation dashboard generation.

Maintain an in-memory map of decision barriers:

```ts
type ConfirmedInvitationDecision = {
  invitationId: number;
  repositoryId: number;
  action: 'accept' | 'decline';
  confirmedAt: IsoInstant;
};
```

The map prevents an invitation list request that began before a `204` from resurrecting the resolved card. Filter any incoming invitation generation through confirmed barriers until a later invitation-list response confirms that the ID is absent. Barriers are memory-only and account-scoped.

Post-mutation reconciliation must not join a dashboard request that began before the mutation. `refreshAfterInvitationDecision()` first awaits that older request, then starts a new generation. This is the only forced-after-current path; ordinary lifecycle triggers continue to coalesce.

#### 18.5.1 Confirmed acceptance

For **Accept**:

1. Require a fresh invitation in current state and install its `accepting` mutation entry.
2. Call `acceptGroupInvitation` once.
3. On `204`, install an `accept` barrier, remove the card from the published invitation list, and announce confirmed GitHub acceptance.
4. Start a forced post-mutation invitation list plus accepted-group discovery.
5. Match the accepted repository by numeric repository ID, not mutable owner/name text.
6. When discovery returns a valid `DiscoveredGroup`, publish it through the normal sorted accepted-group path, remove any accepted-pending-discovery item, and clear the barrier after the invitation list confirms absence.

If `204` is confirmed but the new repository is delayed, inaccessible through the expected installation, excluded for missing/malformed `group.json`, or group discovery fails, store `AcceptedInvitationPendingDiscovery` in memory and show an accepted-but-not-yet-loadable banner with **Retry**. Do not restore the invitation card or call PATCH again. The next normal dashboard refresh retries discovery; it clears the item only when a valid group with the repository ID appears.

An older accepted-group discovery result must not remove a group published by the forced post-mutation generation. Reuse the existing generation/confirmed-mutation reconciliation pattern: only a result at or after the acceptance generation may authoritatively decide whether the newly accepted descriptor exists.

#### 18.5.2 Confirmed decline

For **Decline**, the screen first uses the shared confirmation dialog. Cancelling never enters the provider mutation. After confirmation:

1. Require a fresh invitation and install its `declining` mutation entry.
2. Call `declineGroupInvitation` once.
3. On `204`, install a `decline` barrier, remove the card, update the count, and announce success.
4. Run a forced invitation refresh. Absence clears the barrier; presence is a conflicting remote state and produces a safe retryable error without automatically sending DELETE again.

Decline never starts repository-content discovery on its own, never creates a group descriptor, and never changes cross-group aggregates. A normal dashboard refresh may still run both branches through the shared lifecycle path.

#### 18.5.3 Ambiguous outcomes

After timeout, connection loss, `404`, `409`, or an otherwise ambiguous decision response, do not immediately replay the mutation. Fetch a fresh invitation list; acceptance additionally runs group discovery. Classify the result with a pure function:

```ts
function reconcileInvitationDecision(
  intended: { invitation: PendingGroupInvitation; action: 'accept' | 'decline' },
  openInvitations: readonly PendingGroupInvitation[],
  discoveredGroups: readonly DiscoveredGroup[] | null,
):
  | { kind: 'still_open' }
  | { kind: 'accepted'; group: DiscoveredGroup }
  | { kind: 'resolved_decline' }
  | { kind: 'unknown' }
  | { kind: 'unavailable' };
```

- If the same invitation ID remains open with the same repository ID, preserve the card and permit a new explicit user retry.
- For an intended accept, a valid discovered group with the repository ID is accepted success even though the original response was lost.
- For an intended decline, absence from the fresh invitation list is treated as resolved, as required by the PRD.
- For an intended accept, absence while accepted-group discovery failed is `unknown`; retry reconciliation reads without resending PATCH.
- For an intended accept, absence with no valid discovered group is `unavailable`; explain that the invitation is no longer available without claiming it was accepted, declined, revoked, or expired.
- A reused invitation ID pointing at different repository data is a conflict and also maps to `unavailable`.

If invitation reconciliation fails, or acceptance reconciliation cannot obtain a successful group-discovery result, retain the card in stale state when it still exists locally, clear the busy indicator, and expose `invitation_decision_unknown` with a reconciliation retry. That retry performs reads first and never silently resends PATCH or DELETE.

### 18.6 Cache, aggregates, and consistency boundaries

CR-003 does not change `SnapshotStore`, AsyncStorage key versions, `GroupSnapshotV1`, or repository schemas. Never persist:

- open invitation lists;
- provisional invitation names;
- invitation decision barriers;
- per-card mutation state; or
- accepted-pending-discovery records.

This avoids presenting an old private invitation after process restart or account change. On cold start, hydrate accepted groups exactly as today while invitation state begins as loading and comes only from GitHub. A process restart after confirmed acceptance relies on normal accepted-group discovery; a still-open invitation is fetched again from GitHub.

Invitation cards never contribute to group counts, member previews, currency aggregates, owed/owing totals, spending totals, balances, settlement suggestions, or last-synchronized times. Only a valid `DiscoveredGroup` may enter those selectors. `applyGroupSnapshot` and existing CR-001/CR-002 confirmed-mutation reconciliation remain unchanged.

The owner-side selected-group snapshot may continue caching `PendingMember[] | null` because that data describes one repository already accessible to the current user. This is distinct from the non-persisted account-level received invitation list.

### 18.7 UI, permissions, and accessibility

Place the invitation section in the groups screen list header immediately after the full-width **Create a group** action and before accepted group rows. Omit the entire section when the authoritative fresh list is empty. A stale non-empty list is visibly marked as needing refresh and has no enabled decisions.

Each card renders only validated invitation metadata: provisional name, repository owner/full name, inviter, requested permission, and localized invitation date. Owner, inviter, and repository text are untrusted display strings: render them as plain text, constrain/wrap long values, and never execute or automatically link them.

**Accept** is primary and does not require another confirmation because the labelled button is the explicit decision. **Decline** is secondary and opens a destructive confirmation naming the provisional group and owner and stating that a new invitation will be required to join later. Both buttons include the provisional name in their accessibility label, meet the 44 dp target, expose busy/disabled state, and announce their result through the shared live region.

After confirmed acceptance, keep the user on **Your groups**. When the group validates, insert its normal accepted card in deterministic group order and announce that it was added. When GitHub accepted access but discovery cannot load the group, show the accepted-pending-discovery banner outside **Invited groups** so its state cannot be mistaken for an open invitation.

The screen must distinguish these independent states without replacing the whole list:

- invitations loading while cached groups are visible;
- no fresh invitations;
- one invitation mutating while others remain usable;
- stale invitations awaiting reconciliation;
- invitation-only permission/network/rate-limit failure;
- accepted but group not yet loadable; and
- accepted groups failing refresh while invitations load successfully.

### 18.8 Security, privacy, and operational limits

- Only `GET /user/repository_invitations` for the authenticated token is supported; there is no arbitrary-username invitation lookup.
- A GitHub App user access token may receive `200 OK` with an empty invitation list for a valid pending private-repository invitation. BranchBalance cannot recover invitation metadata or offer in-app accept/decline when GitHub omits the row; the user must accept through GitHub and refresh until the roadmap item is resolved.
- The app never reads or previews repository contents before acceptance and never describes a provisional invitation as a validated BranchBalance group.
- Existing private, personal-account, prefix, invitee, and write-or-greater filters are enforced in the domain boundary even if the UI receives unexpected transport data.
- Invitation IDs are accepted only from current validated state, not route params, free text, deep links, or persisted storage.
- The user token remains in SecureStore-backed session infrastructure and is never passed through React props or invitation domain objects.
- Private repository names and inviter identities are current-screen data. Exclude them from analytics, telemetry, crash breadcrumbs, persistent operation metadata, and user-facing raw errors.
- Accept/decline changes GitHub collaboration only. It does not write `group.json`, expenses, settlements, caches, or a BranchBalance audit record.
- CR-003 remains online-only. No offline mutation queue, automatic background polling, push notification, invitation history, membership removal, organization/team invitation, or leave-repository flow is introduced.

### 18.9 CR-003 test architecture

Extend the platform-free unit suite with table-driven coverage for:

- selected invitation DTO validation, positive safe IDs, personal/private/prefix/invitee rules, and malformed-entry isolation;
- permission ranking and exclusion of read/triage invitations;
- provisional-name derivation, duplicate agreement/conflict, and deterministic ordering;
- invitation barrier filtering against older refresh generations;
- accepted-pending-discovery state transitions; and
- every branch of pure accept/decline ambiguous-outcome reconciliation.

Service/integration tests use the existing scripted GitHub transport, fake clock, authenticated client, and in-memory provider harness to cover:

- empty, one-page, and paginated invitation lists with no partial publish;
- mixed eligible/ineligible entries and safe warning output;
- independent all-settled dashboard refresh outcomes and one shared lifecycle promise;
- `204` accept followed by valid group discovery, delayed visibility, missing/malformed `group.json`, installation mismatch, and discovery failure;
- `204` decline, cancelled decline, and invitation-list confirmation;
- timeout/connection-loss/`404`/`409` reconciliation for still-open, accepted, resolved-decline, unavailable, and read-failure states;
- an invitation refresh begun before a confirmed decision that cannot resurrect the card;
- a group refresh begun before acceptance that cannot overwrite the forced post-mutation generation;
- per-ID duplicate-submit prevention while a different invitation remains actionable;
- token refresh-once, terminal authentication, permission, primary/secondary rate-limit, and reauthorization behavior; and
- sign-out/account-switch clearing all invitation memory without writing new AsyncStorage records.

Component tests cover exact section placement below **Create a group**, hidden authoritative empty state, metadata wrapping, fresh/stale cards, count updates, accessible labels, per-card busy state, decline confirmation/cancel, success announcements, accepted-pending-discovery retry, scoped errors, large text, and accepted-group insertion.

Extend the physical two-account Android acceptance run exactly as required by PRD section 18.12: invite, observe below **Create a group**, decline, resend, accept, validate the new group on both devices, then interrupt the network after acceptance submission and verify read-based reconciliation without duplicate mutation or a false pending card.

### 18.10 Implementation sequence

CR-003 was implemented after the existing Phase 1/CR-001/CR-002 gates were green, in this order:

1. **Domain types and pure decisions:** add transport-independent invitation types, DTO schemas, eligibility/permission rules, provisional naming, ordering, decision barriers, reconciliation, and unit tests.
2. **GitHub gateway:** add paginated list and accept/decline operations, safe typed errors, permission/reauthorization handling, and scripted transport coverage.
3. **Dashboard state:** extend `GroupsProvider` with separate invitation resource/mutation state, all-settled single-flight refresh, non-persistent account cleanup, forced post-mutation generations, and stale-result barriers.
4. **Your groups experience:** place the section below **Create a group**, implement accessible cards, decline confirmation, accepted-pending-discovery recovery, scoped refresh states, and component tests.
5. **Hardening and acceptance:** exercise ambiguous outcomes, pre-mutation refresh races, rate limits, large text, two physical accounts, and the existing typecheck/lint/test/doctor/APK gates.

Organization/team invitations, unrelated GitHub repository invitations, read-only membership, pre-accept repository previews, push/background notifications, invitation history, owner-side cancellation, permission editing, leaving accepted repositories, and offline decisions remain outside CR-003.

## 19. CR-004 architecture delta — On-device activity inbox

CR-004 is specified for implementation. This section defines the additive architecture for PRD change request CR-004; every Phase 1 and CR-001 through CR-003 decision remains in force unless explicitly changed below. The increment supersedes the earlier generic exclusion of “notifications” only for a device-local, foreground-discovered activity summary. Operating-system notifications, push delivery, background work, and a BranchBalance backend remain excluded.

The inbox is not shared application data and is not authoritative. GitHub repository files, commit history, repository access, and open invitations remain authoritative; AsyncStorage holds a bounded account-scoped presentation history, read state, deduplication receipts, and commit checkpoints for this device.

### 19.1 Ownership, source organization, and navigation

Extend `GroupsProvider` rather than adding an `ActivityProvider`. It already lives above the authenticated stack, owns accepted-group and received-invitation discovery, survives navigation between **Your groups** and a selected group, and coalesces every dashboard lifecycle trigger. A second provider with its own GitHub effect would create duplicate or out-of-order discovery generations.

Keep the implementation modular behind an activity feature and storage boundary:

```text
src/
├── app/(app)/
│   ├── _layout.tsx                         # registers groups/activity
│   └── groups/
│       ├── index.tsx                       # inbox icon and unread dot
│       └── activity.tsx                    # recent activity list
├── domain/
│   └── types.ts                            # closed activity/runtime contracts
├── features/
│   └── activity/
│       ├── commit-classifier.ts            # exact safe subject mapping
│       ├── reconciliation.ts               # baseline/checkpoint/dedupe transitions
│       ├── retention.ts                    # deterministic age/count pruning
│       └── destinations.ts                 # typed destination resolution
├── infrastructure/
│   ├── github/
│   │   ├── contracts.ts                    # bounded commit-history operation
│   │   └── gateway.ts                      # DTO validation and pagination
│   └── storage/
│       ├── contracts.ts                    # activity record operations
│       └── snapshot-store.ts               # versioned account activity key
└── providers/
    ├── groups-provider.tsx                 # activity resource and dashboard orchestration
    └── group-provider.tsx                  # reports confirmed local mutations
```

Add `/(app)/groups/activity` to the authenticated stack as a normal pushed screen, not a modal and not a group tab. It remains inside the root `GroupsProvider`. `/(app)/groups` follows the CR-004 update to mockup 03; the activity route follows mockup 12. The mockup script illustrates dismissal and clearing only and is not a persistence or synchronization implementation.

Activity destinations are closed domain values rather than arbitrary route strings. A presentation resolver maps them to the groups screen, selected-group Overview, one expense detail, Spending, or Balances. It constructs owner/repository parameters only from the current validated `DiscoveredGroup`; stored display text and route parameters are never treated as proof of repository access.

No new runtime dependency is required. Use the existing Expo Router, React Context, Zod, AsyncStorage, Lucide icons, confirmation dialog, banners, empty states, refresh control, and accessibility announcement primitives.

### 19.2 Domain and local-record types

Add transport-independent closed types equivalent to:

```ts
type ActivityKind =
  | 'expense_added'
  | 'expense_updated'
  | 'expense_deleted'
  | 'spending_plan_updated'
  | 'spending_plan_removed'
  | 'settlement_recorded'
  | 'settlement_confirmed'
  | 'settlement_deleted'
  | 'group_created'
  | 'group_updated'
  | 'group_invitation_received'
  | 'group_added'
  | 'additional_activity';

type ActivityDestination =
  | { kind: 'groups' }
  | { kind: 'overview' }
  | { kind: 'expense'; expenseId: string }
  | { kind: 'spending' }
  | { kind: 'balances' };

interface ActivityItem {
  id: string;
  source: 'commit' | 'invitation' | 'group' | 'summary';
  sourceId: string;
  repositoryId: number;
  groupKey: GroupKey | null;       // null only before an invitation becomes an accepted group
  groupName: string;
  kind: ActivityKind;
  destination: ActivityDestination;
  actorLogin: string | null;
  eventAt: IsoInstant;
  observedAt: IsoInstant;
  readAt: IsoInstant | null;
}

interface ActivityCheckpoint {
  repositoryId: number;
  groupKey: GroupKey;
  headCommitSha: string | null;
  initializedAt: IsoInstant;
  lastCheckedAt: IsoInstant;
}

interface LocalCommitReceipt {
  repositoryId: number;
  groupKey: GroupKey;
  commitSha: string;
  observedAt: IsoInstant;
}

interface SeenInvitationReceipt {
  invitationId: number;
  lastObservedAt: IsoInstant;
  resolvedAt: IsoInstant | null;
}

interface ActivityInboxV1 {
  version: 1;
  initializedAt: IsoInstant;
  items: ActivityItem[];
  checkpoints: ActivityCheckpoint[];
  localCommitReceipts: LocalCommitReceipt[];
  seenInvitations: SeenInvitationReceipt[];
}
```

The activity `id` is deterministic and contains no user-entered text:

- commit: `commit:<normalized-group-key>:<lowercase-full-sha>`;
- invitation: `invitation:<positive-invitation-id>`; and
- first accepted discovery: `group:<positive-repository-id>:added`; and
- bounded-history fallback: `summary:<normalized-group-key>:<lowercase-newest-sha>`.

Validate UUID resource IDs with the same canonical expense/settlement UUID rule already used by those domains. `sourceId` is the commit SHA, decimal invitation ID, or decimal repository ID only. Validate repository IDs and invitation IDs as positive safe integers; normalize group keys through `groupKey()`; normalize actor logins through `normalizeLogin()`; and validate every instant. An invitation item may retain the provisional name and repository ID supplied by the validated CR-003 model, but it never gains a `GroupKey`, repository route, or decision action before accepted discovery succeeds.

`ActivityItem` stores already-classified labels, not commit messages. UI copy comes from the closed `ActivityKind` catalogue. The destination is derived from the kind and validated UUID, never from remote free text.

### 19.3 Safe commit classification

The gateway may return one short-lived unclassified commit value to the feature boundary:

```ts
interface UnclassifiedGroupCommit {
  sha: string;
  firstMessageLine: string;
  authorLogin: string | null;
  committedAt: IsoInstant | null;
}
```

This value must be classified immediately. Do not place it in provider state, React props, AsyncStorage, logs, telemetry, crash reports, errors, or test snapshots containing arbitrary remote text.

The parser is case-sensitive, examines only the first line, and anchors the complete subject. It maps exactly:

```text
Add expense <uuid>                   -> expense_added / expense
Update expense <uuid>                -> expense_updated / expense
Delete expense <uuid>                -> expense_deleted / overview
Update spending plan                 -> spending_plan_updated / spending
Remove spending plan                 -> spending_plan_removed / spending
Record settlement payment <uuid>     -> settlement_recorded / balances
Confirm settlement payment <uuid>    -> settlement_confirmed / balances
Delete settlement payment <uuid>     -> settlement_deleted / balances
Initialize BranchBalance group       -> group_created / overview
anything else                         -> group_updated / overview
```

A partially matching prefix, invalid UUID, extra suffix, leading whitespace, multiline payload with an unexpected first line, or externally chosen message maps to `group_updated`. The UI never renders the raw subject or UUID. This prevents a collaborator from injecting arbitrary notification copy through a commit message while still providing a safe indication that group data changed.

Use the linked top-level GitHub commit `author.login` when it validates. Do not fall back to the free-form Git author name, committer name, or email. An unlinked or malformed author maps to `actorLogin: null` and is presented as **A collaborator**. Use the validated commit committer timestamp as `eventAt`; if it is absent, invalid, or implausibly in the future, use the local `observedAt` without failing the repository's entire activity check.

### 19.4 GitHub gateway and bounded history reads

Extend the gateway with a product-level bounded operation:

```ts
interface GroupCommitSlice {
  commits: UnclassifiedGroupCommit[];
  checkpointFound: boolean;
  hasMore: boolean;
  warnings: DataWarning[];
}

interface GitHubGateway {
  // Existing operations remain.
  listGroupActivityCommits(
    repository: RepositoryRef,
    stopAtSha: string | null,
    signal?: AbortSignal,
  ): Promise<GroupCommitSlice>;
}
```

Call `GET /repos/{owner}/{repo}/commits` with `sha=repository.defaultBranch`, `per_page=50`, and page numbers beginning at one. Validate repository fields before transport and validate every returned SHA, linked login, message string, and timestamp before mapping. The operation reads no more than two pages and stops as soon as `stopAtSha` is encountered. It returns newest first and includes the checkpoint commit only as the traversal boundary; reconciliation never turns that boundary into a new item.

Follow the shared recommended media type, pinned API version, authentication, pagination-link parsing, token-refresh, timeout, and error mapping. GitHub App user access tokens support this endpoint with **Contents: read**; the existing **Contents: read and write** permission is sufficient. Add no installation permission or authorization scope.

A `409` whose validated GitHub error means the Git repository is empty maps to an empty successful slice. Other `409` responses remain typed repository failures. A malformed page or failure on page two fails that repository's whole slice; do not publish or checkpoint a partial traversal. `403`, `404`, rate limits, and authentication retain their shared meanings, but an activity-only `403`/`404` is not by itself permission to purge the group until accepted-group discovery or the existing complete group path confirms access loss.

Do not use GitHub's Events, Notifications, webhooks, commit-diff, compare, branch-polling, or repository-contents endpoints for the dashboard activity check. Do not filter by a device timestamp: clock skew and rewritten history make the stored commit SHA the traversal boundary.

### 19.5 Baseline, checkpoint, and deduplication algorithm

Activity reconciliation is a pure function over the current `ActivityInboxV1`, validated groups, validated invitations when available, per-repository commit results, and one injected `Clock` instant. It returns one complete next record plus safe per-repository failures; React state does not build items incrementally.

On the first successful activity generation for an account:

1. Set `initializedAt` once.
2. For every accepted group, inspect the bounded commit slice and store its newest SHA as the checkpoint.
3. From all recognized commits whose effective event time is within the previous 30 days, retain the newest 20 across the account and set `readAt` to the initialization instant.
4. Store currently visible eligible invitation IDs as seen without producing unread invitation items.
5. Do not create `group_added` items for groups present in this baseline.

If one repository fails during the first generation, store a checkpoint with a null head as a baseline-pending sentinel. Its later first success follows baseline behavior and imports only read history; an intermittent first-run failure must not turn old commits into unread activity. This sentinel also distinguishes an existing group whose initial history read failed from a repository first discovered after account initialization.

For an initialized repository with a checkpoint:

1. Request its bounded slice with `stopAtSha=headCommitSha`.
2. If the checkpoint is found, classify only commits before it as new observations.
3. If the checkpoint is not found, classify only the newest safe recognizable commits that fit retention, append one `additional_activity` summary, and do not claim that the cause was definitely volume or rewritten history.
4. Deduplicate against current item IDs and `localCommitReceipts`.
5. Set every genuinely remote observation to `readAt: null`, including a commit whose linked actor equals the current account when this device did not record its commit SHA locally.
6. Advance to the newest inspected SHA only after the complete next record can be persisted.

One activity refresh uses at most three concurrent repository-history requests. When a primary or secondary rate limit occurs, stop scheduling additional repositories, allow already-running calls to settle, preserve every uninspected checkpoint, and surface the supplied retry time. Successful repository results may commit alongside failures from other repositories because checkpoints and items are independent per repository; the write still replaces the account activity record once.

For invitations, compare a successful fresh CR-003 list with `seenInvitations`. A new eligible ID creates one unread `group_invitation_received` item and a seen receipt. Update `lastObservedAt` while it remains open; when absent from a fresh list, set `resolvedAt`. Retain an unresolved receipt while its invitation remains visible and retain resolved receipts for 30 days so dismissal or **Clear all** does not recreate recently resolved items. An invitation list failure performs no transition. GitHub's known empty-success limitation remains indistinguishable from a genuine empty list and must not be described as reliable delivery.

For accepted groups, repository IDs already represented by a checkpoint are known. After account initialization, a newly discovered valid repository creates one unread `group_added` item before its read-history baseline is established. A confirmed local create or in-app invitation acceptance registers the repository and corresponding item as read before the post-mutation discovery generation, preventing a false unread item for an action already observed on this device.

### 19.6 Confirmed local repository mutations

The Contents API returns both content/blob state and the commit created by a successful mutation. Preserve that commit reference at the gateway boundary instead of discarding it:

```ts
interface RepositoryCommitRef {
  sha: string;
  committedAt: IsoInstant | null;
}

interface CommittedMutation<T> {
  value: T;
  commit: RepositoryCommitRef | null;
}
```

CR-004 changes repository-writing gateway results to `CommittedMutation<T>` for group-file initialization, expense create/update/delete, spending-plan update/removal, and settlement record/confirm/delete. Delete uses `CommittedMutation<null>` or the updated retained ledger state as appropriate. The commit is null only when GitHub confirmed the authoritative mutation but did not provide, or BranchBalance could not uniquely prove, its commit reference. Keep `ExpenseFile`, `GroupFile`, and `SettlementLedgerFile` focused on current file/blob state; a commit SHA is mutation metadata and must not be added to those file types.

The existing write use cases unwrap `value` for snapshot reconciliation, then call `GroupsProvider.recordLocalActivity()` with the group, closed activity kind, optional validated resource UUID, and commit reference. `GroupsProvider` inserts or updates the deterministic commit item as read and stores a `LocalCommitReceipt`; it does not advance the repository checkpoint. The next commit traversal can therefore discover other members' commits that occurred before the local commit, suppress the already-seen local SHA, advance normally, and then remove receipts at or behind the new checkpoint.

If an ambiguous write is proven successful by the existing semantic read-back logic, the gateway resolves its commit reference with one bounded, path-targeted recent-commit read using the deterministic subject and intended audit identity. If a unique matching commit cannot be proven, finish the authoritative data mutation without inventing activity; the next normal commit traversal may report a remote observation. Activity bookkeeping failure never rolls back or reports failure for a repository mutation GitHub already confirmed.

Dismissal or **Clear all** preserves uncheckpointed `LocalCommitReceipt` values. This prevents a locally observed commit from reappearing as unread if the user clears the item before the next activity traversal. Receipts are removed after a successful traversal passes their SHA or after 30 days.

Invitation accept/decline has no repository commit. The CR-003 decision path records its local invitation resolution as seen/read and, for a confirmed accepted group, registers the repository ID before post-decision discovery. Actions completed on another device are remote observations on this device.

### 19.7 Activity storage and privacy boundary

Extend `SnapshotStore` with narrow operations:

```ts
interface SnapshotStore {
  // Existing operations remain.
  readActivity(accountId: number): Promise<ActivityInboxV1 | null>;
  writeActivity(accountId: number, value: ActivityInboxV1): Promise<void>;
  removeActivity(accountId: number): Promise<void>;
}
```

Use `bb:v1:activity:<account-id>`. This is a new record, not a change to `GroupSnapshotV1`, so existing group-cache keys and schemas do not need a version bump. Add the activity key to `clearAccount()`. Validate the complete record with strict bounds before returning it: maximum 100 items, sane checkpoint/receipt collection limits, unique IDs and repository checkpoints, recognized enums, normalized keys/logins, valid SHAs/UUIDs/instants, and no unknown source or destination variant. Remove a corrupt or unsupported record and treat it as a first-run baseline.

AsyncStorage writes one JSON value atomically at the key boundary. Every hydrate, refresh, local insert, mark-read, dismiss, clear, access-loss purge, and retention operation computes a complete next record, writes it, and only then publishes the matching provider state. If persistence fails, preserve the previous published record and show a scoped local-cache error; never show a dot state that a restart would immediately contradict. A confirmed GitHub mutation remains successful even if its optional local activity insert fails.

Prune items deterministically by effective event time, then observation time and stable ID: remove entries older than 30 days and retain the newest 100. Checkpoints survive item pruning and **Clear all**. Prune resolved invitation receipts and passed/expired local commit receipts after 30 days. Put defensive collection caps above normal retention so a malformed cache cannot allocate unbounded memory.

This record is app-sandboxed private cache data, not a credential vault. It may contain group names and GitHub logins already available elsewhere in the account cache, but must never contain:

- access/refresh tokens, device codes, authorization headers, or raw GitHub response bodies;
- raw commit subjects/bodies, diffs, author names, emails, or arbitrary URLs;
- expense descriptions, amounts, shares, categories, or payment methods;
- settlement amounts, notes, transaction references, bank names, or financial-account identifiers; or
- complete invitation/repository DTOs or data that can authorize an invitation decision.

Sign-out, terminal session expiry, revoked credentials, and explicit account clearing remove the entire record. `GroupsProvider.removeGroup()` also removes that repository's items, checkpoint, and local receipts after confirmed access loss, then persists group and activity cache changes before exposing the final state. Pending invitation items remain non-actionable summaries; decisions always resolve against the current validated `invitationState`.

### 19.8 GroupsProvider state and foreground orchestration

Extend the context without changing selected-group snapshot ownership:

```ts
interface GroupsContextValue {
  // Existing members remain.
  activityState: ResourceState<ActivityItem[]>;
  hasUnreadActivity: boolean;
  activityWarning: string | null;
  markActivityRead(itemIds: readonly string[]): Promise<void>;
  dismissActivity(itemId: string): Promise<void>;
  clearActivity(): Promise<void>;
  recordLocalActivity(input: ConfirmedLocalActivity): Promise<void>;
}
```

Hydrate activity with the same account-ID/epoch and revision guards used by groups so a slow old-account read cannot overwrite a newer account or remote generation. Derive `hasUnreadActivity` exclusively from validated items whose `readAt` is null; the header dot has no separate boolean to drift out of sync.

`GroupsProvider.refresh()` remains the only dashboard single-flight promise. Extend its all-settled orchestration:

1. Start accepted-group and invitation discovery as CR-003 defines.
2. When accepted-group discovery succeeds, start bounded commit checks against that validated group generation.
3. Reconcile successful fresh invitations when available; invitation failure preserves receipts and items.
4. Persist and publish accepted groups, invitation memory state, and activity as separate result domains so one failure does not erase another domain.
5. Resolve the shared refresh promise only after every started branch settles; pull-to-refresh indicators observe group, invitation, and activity refreshing state.

Authenticated launch, **Your groups** focus, Activity focus, foreground return while either screen is visible, pull-to-refresh, and explicit retry all call this same `refresh()`. Activity adds no timer, root background listener, headless task, worker, or notification registration. The existing visible-resource rule remains: foregrounding a selected group refreshes that group, not the account-wide inbox; its confirmed remote snapshot may later contribute only through normal top-level activity discovery.

An activity screen that focuses while a group-list refresh is already running joins it. A group screen mutation may call `recordLocalActivity()` without triggering commit discovery. Account changes increment the existing epoch, reset activity state, cancel/ignore old read results, and hydrate only the new account's key.

`markActivityRead()` receives the exact IDs rendered by the committed activity-screen generation. It sets those items' `readAt` once in one store update; an item inserted after that render remains unread. `dismissActivity()` removes exactly one validated current ID. `clearActivity()` requires UI confirmation and replaces only `items` with an empty array while retaining checkpoints, invitation receipts, and local commit receipts. Repeated calls are idempotent.

### 19.9 UI behavior, destinations, and accessibility

On **Your groups**, place an inbox icon button in the account heading row before the account avatar. Use at least a 44-by-44 logical-pixel target. Overlay a small accent dot when `hasUnreadActivity` is true. The button's complete accessible label is **Activity inbox** or **Activity inbox, new activity**; the dot is hidden from the accessibility tree and is not the only unread signal.

The Activity screen renders cached items immediately in one virtualized newest-first list. Its list header contains the foreground-delivery explanation, last successful check, scoped stale/error banner, and **Clear all** when items exist. Rows show only the closed action label, validated group/provisional name, `@actor` or **A collaborator**, relative visual time, and accessible absolute timestamp. Unread rows include a textual/accessibility **New** state and a non-colour visual treatment.

Each row has one primary navigation press target and a separate, explicitly labelled **Dismiss** icon button. A horizontal right swipe progressively reveals a safe **Clear** affordance; crossing the deliberate distance or velocity threshold animates the row away and calls the same exact-item dismissal path, while an incomplete or vertically dominant gesture returns the row to rest. Swipe is an enhancement, never the only way to dismiss an item, and must not capture ordinary vertical list scrolling. Do not use a hidden long-press menu. **Clear all** uses the shared confirmation dialog and explicitly says it clears this device only and does not undo group actions. After dismissal or clearing, announce the result through the existing live-region/status pattern. The empty state explains that items appear after a foreground GitHub refresh.

After a committed Activity list generation renders, call `markActivityRead(renderedIds)` once for that generation. Do not mark items during storage hydration before they have been rendered, during a failed route transition, or merely because the header icon was focused. Keep the visible **New** styling stable for the current render to avoid an immediate visual flash; the dot and future render derive the persisted read state.

Resolve navigation against the latest `GroupsProvider.state.data`:

- invitation items return to **Your groups**, where only a current live invitation card can accept or decline;
- group added/created/updated and deleted-expense items open Overview;
- added/updated expense items open the expense detail after the selected `GroupProvider` completes its normal refresh and confirms the ID still exists;
- spending-plan items open Spending; and
- settlement items open Balances.

If the group is no longer accessible, purge under section 19.7 and remain on **Your groups** with the existing access-loss explanation. If a target expense/payment was changed or deleted, keep the user in the relevant current tab, announce that the item is no longer available, and never reconstruct it from activity metadata.

### 19.10 Failure, consistency, and operational limits

Activity errors are scoped presentation failures:

- A transient commit-history failure preserves current items, read state, and that repository's checkpoint and marks the inbox stale.
- A persistence failure preserves the previously published dot/list and offers retry; it does not invalidate accepted groups or live invitations.
- Accepted-group failure prevents commit checkpoint advancement for that dashboard generation, but a separately successful invitation result may still update its seen receipts.
- One repository failure does not discard successful slices for other repositories. Summarize failed group count without exposing private repository names in global errors or logs.
- A failed check never clears unread state or updates “checked just now.” `lastSuccessfulAt` advances only for the domains that committed validated results.
- Terminal authentication follows session expiry and account-cache clearing. A one-time authenticated-request replay after `401` remains safe because all activity reads are idempotent.
- Rate limiting preserves unscheduled and failed checkpoints and presents GitHub's retry time when supplied.

Commit history can be delayed, rewritten, exceed the 100-commit traversal bound, or contain changes from clients that do not use BranchBalance's deterministic subjects. The generic and `additional_activity` kinds are deliberate truth-preserving fallbacks. UI and accessibility copy must say **Recent activity** and **observed**; do not say delivered, notified in real time, complete, or audited.

The feature performs one bounded history read per accepted group when the top-level dashboard refreshes. It does not refresh every group snapshot, inspect file diffs, fetch historical file versions, or recompute balances. Large-account latency and rate usage must be measured during implementation; keep concurrency at three and the two-page cap unless a later CR changes the product tradeoff.

### 19.11 CR-004 test architecture

Add table-driven unit coverage for:

- every exact deterministic subject, canonical UUID extraction, and destination mapping;
- invalid UUIDs, partial prefixes, extra suffixes, whitespace, casing, multiline and malicious messages, and safe generic fallback;
- author normalization/fallback without name or email leakage and timestamp fallback;
- deterministic IDs/order, commit/invitation/group deduplication, same-login remote unread behavior, and local-receipt suppression;
- first account/repository baseline, 30-day read backfill, maximum 20 initial items, normal checkpoint traversal, unreachable checkpoint summary, and empty history;
- item age/count pruning, checkpoint survival, invitation-receipt lifecycle, local-receipt expiry, read derivation, dismiss, clear, and account isolation; and
- strict `ActivityInboxV1` validation, duplicate checkpoint rejection, collection bounds, and corrupt-cache removal.

Gateway/service tests use the scripted GitHub transport, fake clock, and in-memory store to cover:

- default-branch `sha`, 50-item pages, one-page stop, second-page checkpoint, two-page cap, Link handling, and no timestamp filtering;
- valid/invalid commit DTOs, nullable linked authors, empty-repository `409`, malformed page-two atomic failure, `401` refresh, `403`, `404`, other `409`, timeout, network failure, and both rate-limit classes;
- first-run partial repository failure followed by read baseline, mixed repository success/failure, stopped scheduling after rate limit, and atomic per-account persistence;
- local expense, spending-plan, settlement, and group-init commit insertion, later history deduplication, other commits before a local SHA, clear-before-checkpoint receipt protection, and ambiguous-write commit resolution;
- fresh/failed/empty invitation generations, CR-003 visibility limitation, in-app acceptance/decline, external acceptance, and newly accessible group classification;
- stale cache hydration versus newer refresh, account epoch switch, sign-out, confirmed access loss, and cache-write failure without mutation rollback; and
- launch/focus/foreground/pull/retry single-flight behavior with no request while the app is backgrounded or closed.

Component/navigation coverage verifies mockups 03 and 12: icon placement and touch target, dot/no-dot labels, cached items during refresh, New state without colour dependence, relative plus accessible absolute time, actor fallback, list ordering, scoped errors, refresh control, every destination, missing-resource fallback, separate Dismiss targets, clear confirmation/cancel/success, empty state, live announcements, and large-text/small-screen layout.

Run the PRD section 19.12 physical two-device scenario. Additionally inspect Android network logs while the app is backgrounded and closed to prove no history request occurs, interrupt one activity refresh after page one, exercise a rate-limited repository beside a successful one, clear before a local commit is checkpointed, restart and switch accounts, and verify that no settlement note, amount, expense description, raw commit text, or author email appears in AsyncStorage or logs.

### 19.12 Implementation sequence

Implement CR-004 after the PRD and this architecture are approved, in this order:

1. **Pure activity domain:** closed kinds/destinations, exact safe classifier, deterministic IDs/order, baseline/checkpoint reconciliation, receipts, retention, and unit tests.
2. **Versioned local store:** strict `ActivityInboxV1` schema, account key, atomic transforms, clear-account/access-loss cleanup, corruption behavior, and storage tests.
3. **GitHub read path:** bounded default-branch commit operation, DTO validation, two-page/checkpoint behavior, concurrency/rate-limit policy, and scripted gateway coverage.
4. **Dashboard orchestration:** hydrate and expose activity in `GroupsProvider`, extend the dashboard single flight, reconcile invitations/new groups, implement read/dismiss/clear, and harden account-generation races.
5. **Local mutation receipts:** preserve Contents API commit references, report successful group/expense/plan/settlement actions, resolve ambiguous successes, and prove no duplicates or mutation rollback.
6. **Your groups and Activity UI:** implement mockups 03/12, typed destinations, missing-target behavior, accessibility, empty/stale/error states, and component/navigation tests.
7. **Hardening and acceptance:** retention and large-history cases, rate usage, privacy inspection, background network proof, two-device manual flow, and the existing typecheck/lint/test/doctor/docs/APK gates.

Push notifications, background fetch/polling, webhooks, a backend, cross-device read/dismiss synchronization, complete audit history, reminders/digests, custom notification preferences, diff-derived content summaries, and GitHub notification-center parity remain outside CR-004.

## 20. CR-005 architecture delta — Pace, mix, and fairness analytics

**Increment status:** Implemented; physical-device acceptance pending

CR-005 is a derived presentation increment over the existing CR-001 spending snapshot and CR-002 balance result. GitHub remains authoritative, all money remains integer minor units, and the application retains one selected-group refresh lifecycle. CR-005 adds no remote schema field, GitHub request, background task, telemetry event, backend service, database, cache-key migration, or charting dependency.

### 20.1 Ownership and dependency boundaries

Keep the new platform-free logic under `domain/spending/` and the native visual components under `features/spending/`. Overview, Spending, and Balances consume the same committed `RemoteGroupSnapshot` generation:

- `SpendingSummary` owns expense-derived analytics because the snapshot cache already treats spending as non-authoritative and reconstructs it during hydration.
- The Balances funding chart uses a pure selector over `BalanceResult.members`. It reads only `totalPaidMinor` and `totalShareMinor`; `netMinor` remains the confirmed-settlement-adjusted result shown by the existing member cards.
- Screen components format values and draw geometry but do not aggregate expense money, rank categories, choose insights, or calculate pace.
- `GroupProvider` remains the sole selected-repository owner. Do not add an analytics provider, store, reducer, refresh hook, or mutation action.

Use the installed `react-native-svg` package directly. A general-purpose chart package is not justified for the required line, bar, and stacked comparisons. Charts do not animate, which satisfies reduced-motion behavior and avoids animation state becoming part of comprehension.

### 20.2 Runtime analytics contracts

Extend the existing runtime-only summary with structured values rather than formatted sentences:

```ts
interface SpendingSummary {
  // Existing CR-001 totals, budget, and trip fields remain unchanged.
  analytics: SpendingAnalytics;
}

interface SpendingAnalytics {
  today: CalendarDate;
  daily: {
    buckets: Array<{ date: CalendarDate; amountMinor: number }>;
    period: null | {
      startsOn: CalendarDate;
      endsOn: CalendarDate;
      totalDays: number;
    };
    preTripMinor: number;
    afterTripMinor: number;
    futureDatedMinor: number;
    distinctExpenseDateCount: number;
  };
  pace: null | {
    actualToDateMinor: number;
    evenPaceMinor: number;
    deltaMinor: number;
    direction: 'below' | 'on' | 'above';
    elapsedDays: number;
    totalDays: number;
    events: Array<{ date: CalendarDate; cumulativeMinor: number }>;
    referenceEvents: Array<{ date: CalendarDate; cumulativeMinor: number }>;
  };
  categoryMix: Array<{
    category: CategoryBucket;
    spentMinor: number;
    sharePercentage: number;
  }>;
  scopeMix: {
    sharedMinor: number;
    justMeMinor: number;
  };
  insights: SpendingInsight[]; // maximum three, including pace
}

interface ExpenseFundingAnalytics {
  scaleMaxMinor: number;
  rows: Array<{
    login: string;
    paidMinor: number;
    shareMinor: number;
    gapMinor: number;
    currentMember: boolean;
  }>;
}
```

`SpendingInsight` is a closed discriminated union carrying the values needed to format pace delta, total/category overage, largest category, current-user funding gap, highest day, or scope split. Domain logic selects insights; React components own localized money, date, and percentage formatting.

Add an exact-date dimension to the ephemeral filter contract:

```ts
interface SpendingFilters {
  date: 'all' | CalendarDate;
  category: 'all' | CategoryBucket;
  paymentMethod: 'all' | PaymentMethodBucket;
  payer: 'all' | string;
  scope: 'all' | 'shared' | 'just_me';
}
```

`deriveExpenseFundingAnalytics(balanceMembers, currentLogin)` orders the current user first and every other row by normalized login. It uses one common scale equal to the greatest Paid or Share value, falling back to one minor unit for an all-zero result. It never derives gap from `netMinor`.

### 20.3 Sparse daily and pace derivation

`deriveSpendingSummary` performs one checked pass over valid expenses. Alongside the existing totals it accumulates a sorted date-to-amount map and Shared/Just me totals. Do not allocate an array containing every configured calendar date: valid plans can span a long period. The runtime summary stores sparse non-zero date buckets plus period bounds.

The Day-by-day component uses a horizontal `VirtualizedList` for a configured period. `getItemCount` is `totalDays`, and `getItem` derives the date at an index with domain calendar helpers and looks up the sparse amount, defaulting to zero. Without configured dates, it displays the sorted distinct expense-date buckets only. Pre-trip and after-trip amounts are separate aggregate summaries and are not silently assigned to the first or last trip day.

During an active trip, cumulative events contain:

1. The trip start with all pre-trip spending plus spending on the first day.
2. Each later non-zero trip date on or before `today`, after applying that date's amount.
3. A `today` endpoint when the last spending event occurred earlier, so the plotted line visibly stays flat.

Future-dated expenses remain in total/category/scope analytics and their daily buckets, but are excluded from `actualToDateMinor` and active-trip cumulative events. `futureDatedMinor` activates explicit tracked-future copy. The actual plot stops at today and never resembles a forecast.

Even pace exists only while `today` is inside a complete dated plan with a positive budget:

```text
quotient = floor(budgetMinor / totalDays)
remainder = budgetMinor % totalDays
evenPaceMinor = quotient * elapsedDays
              + floor(remainder * elapsedDays / totalDays)
deltaMinor = actualToDateMinor - evenPaceMinor
```

This is algebraically equivalent to flooring `budgetMinor * elapsedDays / totalDays` without unsafe multiplication. Before the period, use existing planned-per-day copy and omit pace. After it, use existing final budget performance and omit a current-pace claim.

Category mix is sorted by amount descending, then the CR-001 taxonomy order with Uncategorized last. Scope totals must satisfy `sharedMinor + justMeMinor = totalSpentMinor`. Insight eligibility follows PRD section 20.5; total-budget overage wins priority two, otherwise choose the largest category overage by amount and taxonomy, and highest-day ties choose the earliest date. With no expenses, return no insights. The pace conclusion is the first insight and appears in the pace card rather than being duplicated by Spending Pulse.

### 20.4 Snapshot and synchronization behavior

Capture `today` once per refresh or local rebuild and pass that same value to the complete spending derivation. Extend all existing paths rather than creating an analytics-specific path:

- Gateway refresh derives balances and spending analytics before returning one snapshot.
- Cache hydration discards cached derived spending as it does today and recomputes analytics using the current local date.
- Expense add/edit/delete and spending-plan update/removal call the existing snapshot rebuild and publish totals, balances, and analytics together.
- Settlement confirmation changes `netMinor` but leaves expense-derived spending analytics and funding Paid/Share values unchanged; the Balances screen still rerenders both from one new snapshot generation.

An unsafe analytical sum follows the existing spending-integrity failure: set `spending` to null, add the scoped warning, and render no financial chart from partial values. Filtering and chart selections are local component state and never enter the snapshot cache.

### 20.5 Native UI and accessibility

Spending follows this order: existing budget summary, Group spent/You paid/Your share, Budget pace, Day by day, remaining Spending Pulse insights, Category mix, Shared vs Just me, payment methods, and expense explorer.

- Budget pace draws a solid actual path, dashed even-reference path, today marker, labels, and a textual actual/reference/difference summary. Geometry normalizes against the greater of budget and actual values and does not perform business calculations.
- Day by day renders every configured day through the sparse lookup. Each real calendar-day bar is an accessible button with amount/date text and applies the exact-date filter. Pre/after aggregates are descriptive rather than date-filter buttons.
- Category rows expose separate, labelled share-of-total and category-limit progress tracks. Pressing a row applies the category filter; the explorer chips remain the non-chart alternative.
- Shared vs Just me uses a labelled stacked bar plus two explicit scope-filter buttons and reminds users that Just me is shared group data.
- Balances inserts Expense funding before Member totals. Paid and Share use labelled paired bars on one scale; the card states that confirmed settlements affect net balances below, not this expense-only gap.

Selecting a day, category, or scope updates the corresponding visible filter, scrolls to the explorer through an optional `Screen` scroll-view ref, moves accessibility focus to the result heading, and announces the new result count. The explorer adds an All dates/Choose date control using the existing date-picker dialog. Clear filters resets every dimension including date.

Charts use `accessibilityRole="image"` and a complete accessible label while decorative SVG elements are hidden. All visible series also have ordinary scalable text. Solid/dashed treatment, labels, icons, and status words ensure that colour is never the only distinction. Large text may wrap chart summaries and horizontally scroll day bars; no essential value is embedded only in fixed-size SVG text.

Overview wraps its compact budget summary in one accessible button that opens Spending. During an active dated budget, it adds the textual pace conclusion and a non-interactive sparkline only when at least two distinct expense dates exist. Before/after, missing-budget, and sparse states keep textual budget behavior without manufacturing a trend.

### 20.6 Test architecture and implementation sequence

Add platform-free unit coverage for sparse buckets, missing days, long periods, pre/after/future expenses, cumulative events, overflow-safe even pace, one-day periods, every phase, category/scope reconciliation, insight priority/ties/limit, exact-date filtering, and settlement-independent funding gaps.

Component coverage verifies the three updated mockups: Spending hierarchy and graphical/text parity, daily/category/scope filter interactions, date picker, combined/clear filters, scroll/focus/live announcement behavior, empty/sparse/future states, Overview eligibility/navigation, Balances common-scale funding and settlement explanation, light/dark themes, large text, and minimum touch targets.

Implement in this order:

1. Runtime types, calendar-at-offset helper, sparse analytics derivation, funding selector, date filter, and unit tests.
2. Accessible SVG/native chart cards with no animation and component-level graphical/text parity tests.
3. Spending hierarchy and interactive explorer integration.
4. Overview compact pace and Balances expense-funding integration.
5. Refresh/hydration/mutation coherence tests, accessibility hardening, full validation, and the PRD section 20.12 physical-device scenario.

Forecasting, planned expenses, external benchmarks, cross-group/cross-currency aggregation, historical comparisons, exports, configurable dashboards, server analytics, telemetry, background work, and predictive alerts remain outside CR-005.

## 21. CR-006 architecture delta — Private on-device receipt scanning

**Increment status:** Proposed; feasibility and product review required before implementation

CR-006 adds an optional local input pipeline in front of the existing Add expense form. It does not change the authoritative expense schema, GitHub gateway, balance calculations, spending derivation, settlement logic, group snapshot, or online save behavior. Manual entry remains the baseline and recovery path.

The architectural privacy boundary is strict: capture, image preparation, OCR, receipt parsing, confidence evaluation, and prefill handoff run inside the application process on the device. There is no network edge between receipt capture and form review. Only the final ordinary expense fields explicitly confirmed by the member may reach the existing GitHub mutation.

```text
                         Android application boundary
┌──────────────────────────────────────────────────────────────────────┐
│ Overview split action                                                │
│   ├── Add expense ────────────────────────────────┐                  │
│   └── Camera segment → receipt scanner            │                  │
│                           ↓                        │                  │
│                temporary image preparation        │                  │
│                           ↓                        │                  │
│          local Expo module → ONNX Runtime Mobile  │                  │
│                           ↓                        │                  │
│        PaddleOCR blocks: text + confidence + box  │                  │
│                           ↓                        │                  │
│       strict schema → deterministic TS parser     │                  │
│                           ↓                        │                  │
│      validated, sanitized in-memory prefill ──────┤                  │
│                                                    ↓                  │
│                                  existing Add expense form           │
│                                                    ↓ explicit save    │
└────────────────────────────────────────────────────┼─────────────────┘
                                                     ↓
                                           existing GitHub gateway
```

No receipt image, raw OCR block, parser evidence, confidence score, or scan diagnostic crosses the bottom boundary.

### 21.1 Ownership, source organization, and dependency direction

Keep receipt scanning as a self-contained feature with one narrow native port. The proposed source delta is:

```text
src/
├── app/(app)/groups/[owner]/[repo]/expenses/
│   └── scan.tsx                         # capture/choose/progress surface
├── features/receipt-scanning/
│   ├── capture-receipt.ts               # camera/photo-library adapters
│   ├── prepare-receipt-image.ts         # bounded resize/orientation render
│   ├── receipt-ocr.ts                    # app-facing native port
│   ├── receipt-ocr-schema.ts             # strict untrusted-boundary schema
│   ├── parse-receipt.ts                  # platform-free deterministic parser
│   ├── validate-receipt.ts               # confidence/arithmetic/currency policy
│   ├── receipt-scan-machine.ts            # cancellation and state transitions
│   ├── receipt-temp-files.ts              # ownership-aware cleanup
│   ├── receipt-prefill.ts                 # sanitized form handoff
│   └── receipt-draft-provider.tsx         # selected-group-scoped memory only
└── features/expenses/
    └── expense-form.tsx                  # existing form consumes prefill once

modules/paddle-ocr/
├── expo-module.config.json
├── src/                                 # TypeScript native-module contract
├── android/                             # Kotlin module and inference pipeline
├── ios/                                 # later Swift parity; not CR-006 delivery scope
└── models/                              # manifest; binaries only after approval
```

Dependency direction is one-way:

```text
scanner screen → scan orchestration → ReceiptOcrPort
                                ├── pure parser/validator → money/date domain helpers
                                └── native PaddleOCR adapter
```

The native module knows nothing about groups, expenses, currencies supported by the product, navigation, GitHub, form state, or persistence. It returns recognized text geometry only. The TypeScript parser knows nothing about React Native, Expo, ONNX Runtime, or native model tensors. The expense form receives only sanitized eligible values and review messages; it never imports the OCR module.

Do not add receipt behavior to `GroupProvider`, `SnapshotStore`, the GitHub gateway, or the persisted expense domain. A narrow `ReceiptDraftProvider` may be mounted inside the selected-group layout solely to hand one in-memory prefill from the scanner route to the Add expense route. It must clear when consumed, cancelled, the selected group changes, access is lost, or the session ends.

### 21.2 Proposed dependencies and development-build boundary

CR-006 proposes these direct dependencies only after its feasibility gate is approved:

| Dependency | Architectural purpose |
|---|---|
| `expo-camera` | In-app receipt camera preview and capture |
| `expo-image-picker` | Select an existing receipt image without importing the library asset into app storage |
| `expo-image-manipulator` | Decode, orientation-normalize, resize, and re-encode a bounded working image |
| `expo-file-system` | Delete only app-owned temporary receipt files and perform stale-cache cleanup |
| `expo-dev-client` | Run and debug the application with the custom native OCR code included |
| ONNX Runtime Mobile native packages | Execute approved ONNX models locally on Android and, later, iOS |

Use `npx expo install` for Expo packages at implementation time so versions match the then-current project SDK. Pin native ONNX Runtime versions in the local module manifests after the model compatibility spike; do not use floating `latest` native dependencies in repeatable builds.

The project remains Expo-managed through Continuous Native Generation, but Expo Go is no longer a valid runtime for receipt scanning because it cannot contain the local PaddleOCR module or its model runtime. The camera route must detect a missing native module and explain that a current BranchBalance Development Build is required rather than crashing during import. Manual expense entry must continue to work in Expo Go and web previews.

Configure camera and photo-library permission copy through app configuration. Receipt capture does not record video or audio, so the scanner must not request microphone permission. Adding or changing native code, models, native dependencies, or permission configuration requires rebuilding the development client.

CR-006 does not add SQLite or another local database. Existing expenses remain GitHub-backed, existing non-secret snapshots remain in AsyncStorage, and scanner state is temporary memory/cache data only.

### 21.3 Capture and image-preparation contracts

Track source ownership explicitly so cleanup cannot delete a member's photo-library original:

```ts
type ReceiptImageOwnership = 'app_cache' | 'external_original';

interface CapturedReceipt {
  uri: string;
  width: number;
  height: number;
  ownership: ReceiptImageOwnership;
}

interface PreparedReceipt {
  uri: string;
  width: number;
  height: number;
  ownership: 'app_cache';
}
```

`expo-camera` output is app-owned cache data. A photo-library URI is externally owned and read-only from BranchBalance's perspective. `prepareReceiptImage()` always creates a new app-owned working file and never overwrites the input.

Image preparation follows one deterministic policy:

1. Validate a local file/content URI and positive sane dimensions before native inference.
2. Decode through ImageManipulator so EXIF orientation is applied.
3. Preserve aspect ratio and constrain the longest dimension to 1,800 pixels; do not upscale a smaller image.
4. Render a JPEG working copy at 0.9 quality without Base64 crossing the JavaScript bridge.
5. Pass the local working URI to the native OCR module.

The 1,800-pixel bound controls JavaScript/native image memory but does not replace model-specific preprocessing. The native detector may further resize to its manifest-defined input policy while maintaining a transform back to prepared-image coordinates.

Do not automatically save camera images to the photo library. Never place receipt content in filenames, route URLs, query parameters, AsyncStorage keys, accessibility identifiers, logs, crash breadcrumbs, or analytics. Temporary filenames use opaque random values.

The temporary-file manager maintains an explicit set of app-owned paths for the active attempt. It deletes the prepared image plus the camera source, when applicable, after successful prefill handoff, cancellation, or terminal failure. It never deletes an `external_original`. A bounded startup cleanup removes only stale files inside the scanner's dedicated cache directory after verifying the resolved path is within that directory. Failure to delete is logged only as a content-free error code and retried by later bounded cleanup.

### 21.4 Native OCR module contract

The TypeScript side treats every native return as `unknown` until strict runtime validation succeeds:

```ts
type OcrPoint = { x: number; y: number };

interface OcrBlock {
  text: string;
  confidence: number; // finite, inclusive 0...1
  points: [OcrPoint, OcrPoint, OcrPoint, OcrPoint];
}

interface OcrResult {
  width: number;
  height: number;
  blocks: OcrBlock[];
}

interface ReceiptOcrStatus {
  state: 'ready' | 'module_unavailable' | 'models_missing' | 'models_incompatible';
  engine: 'paddle_ocr';
  modelBundleVersion: string | null;
  safeMessage: string;
}

interface ReceiptOcrPort {
  getStatus(): Promise<ReceiptOcrStatus>;
  recognize(request: { requestId: string; imageUri: string }): Promise<unknown>;
  cancel(requestId: string): Promise<void>;
}
```

The native module name and exported method names are identical across platforms. Android implements the approved CR-006 runtime in Kotlin. A later iOS delivery must provide the same contract in Swift and pass the same fixtures; CR-006 does not require shipping or scaffolding iOS while iOS remains outside product scope.

Validate native output with strict Zod schemas before parsing. Apply defensive limits to result dimensions, block count, text length, coordinate magnitude, and aggregate recognized-text size so a corrupt module response cannot allocate or render unbounded data. Reject non-finite coordinates/confidence, out-of-range confidence, blank text, invalid quadrilaterals, and coordinates materially outside the declared image bounds.

Native errors use closed, content-free codes such as:

```ts
type ReceiptOcrErrorCode =
  | 'module_unavailable'
  | 'models_missing'
  | 'models_incompatible'
  | 'image_unreadable'
  | 'out_of_memory'
  | 'inference_failed'
  | 'cancelled';
```

Error messages never contain the URI, recognized text, tensor values, merchant, amount, or model output. Unknown native errors map to `inference_failed` with a safe manual-entry alternative.

### 21.5 PaddleOCR and ONNX Runtime boundary

The Android native pipeline owns:

1. Opening the local prepared image without network access.
2. Applying manifest-defined color order, normalization, shape, and detector resizing.
3. Running PaddleOCR mobile text detection through ONNX Runtime.
4. Performing the matching DB detection postprocessing to produce ordered quadrilaterals.
5. Perspective-correcting each detected text crop.
6. Optionally applying the approved text-line orientation classifier.
7. Running the matching mobile recognition model for each crop.
8. Applying CTC decoding with the exact dictionary used during model export.
9. Returning recognized text, confidence, and points mapped into prepared-image pixel coordinates.

Model preprocessing and postprocessing constants belong in one model-bundle description, not as unrelated Kotlin/Swift magic numbers. Detection thresholds, unclip ratio, recognition input height, normalization, dictionary order, blank token, and orientation behavior must match the exported artifacts.

Every candidate model bundle requires a checked-in, human-readable manifest before binary inclusion:

```text
engine and upstream model names
upstream repository/tag/commit and download URLs
code and weight licenses
Paddle-to-ONNX conversion command/tool versions
ONNX opset and required operators
SHA-256 for each ONNX model and dictionary
input/output tensor names, shapes, dtypes, and normalization
supported scripts/languages
expected disk size and benchmark record
```

The build must fail when packaged hashes do not match the approved manifest. There is no runtime model downloader in the first increment. Bundling model resources makes airplane-mode behavior deterministic and prevents a first scan from becoming a hidden network operation.

Load ONNX sessions lazily on first scan, cache them for reuse while memory pressure permits, and run inference away from the UI thread on one serial worker. Only one receipt inference may be active per module instance. Cancellation marks the request abandoned immediately, prevents delivery of late results, and releases intermediate bitmaps/tensors as soon as the runtime permits. Native code closes tensors, results, sessions, streams, and bitmaps deterministically.

Start with the CPU execution provider for the feasibility baseline. NNAPI or another accelerator may be enabled only after per-device correctness and performance comparison; hardware acceleration must not create different parsing semantics or become required for supported devices. A reduced ONNX Runtime build is an optimization after the operator set is proven, not a prerequisite for the first benchmark.

### 21.6 Deterministic receipt parsing and validation

OCR recognizes text; it does not decide expense semantics. Platform-free TypeScript code owns line grouping, field candidate selection, validation, and review policy.

Group blocks into reading-order lines using prepared-image coordinates and a documented vertical tolerance. Stable sorting uses vertical center, then left coordinate, then original block index. Candidate scoring and ties are deterministic and use centralized benchmark-tuned thresholds rather than values embedded in UI components.

Use closed field contracts based on integer minor units:

```ts
type ReviewReason =
  | 'missing'
  | 'low_confidence'
  | 'ambiguous'
  | 'currency_mismatch'
  | 'arithmetic_inconsistent';

interface ReceiptExtraction {
  merchant?: { value: string; confidence: number };
  date?: { value: CalendarDate; confidence: number };
  currency?: { value: CurrencyCode; confidence: number };
  subtotalMinor?: { value: number; confidence: number };
  taxMinor?: { value: number; confidence: number };
  tipMinor?: { value: number; confidence: number };
  totalMinor?: { value: number; confidence: number };
  review: Array<{ field: 'merchant' | 'date' | 'currency' | 'total'; reason: ReviewReason }>;
}
```

Receipt amount parsing must not convert through binary floating-point decimal values. Select a currency/decimal convention from explicit receipt evidence, normalize separators, and convert digit strings directly to safe integer minor units. Reject signs for an expense total, unsupported precision, unsafe magnitude, and malformed grouping. Explicit EUR/USD/GBP codes outrank symbols when evidence conflicts.

Parser policy follows the PRD:

- Merchant candidates come from prominent high-confidence lines near the top after excluding dates, totals, generic receipt terms, and tax/payment identifiers.
- Date candidates must produce valid calendar dates. An ambiguous all-numeric date without enough locale/currency evidence is review-only.
- Total candidates require an approved label such as Total, Amount due, A pagar, or Valor total. `subtotal` is excluded before the total-label expression and cannot win through substring matching.
- Candidate ranking favors label quality, confidence, and lower receipt position. Stable coordinates resolve exact ties.
- Currency absence remains unknown. A detected currency that differs from the group produces a review reason and prevents Amount prefill.
- When subtotal exists, `subtotalMinor + taxMinor + tipMinor` may differ from `totalMinor` by at most two minor units. A larger difference prevents silent Amount prefill.

The final `ReceiptExtraction` passes its own strict Zod schema. Parser evidence and raw blocks are no longer needed after producing the sanitized review result and must be released before navigation.

### 21.7 Scan state, cancellation, and lifecycle

Model the scanner as a closed state machine rather than independent booleans:

```ts
type ReceiptScanState =
  | { kind: 'checking_runtime' }
  | { kind: 'permission_required' }
  | { kind: 'camera_ready' }
  | { kind: 'captured'; receipt: CapturedReceipt }
  | { kind: 'preparing'; requestId: string }
  | { kind: 'recognizing'; requestId: string }
  | { kind: 'validating'; requestId: string }
  | { kind: 'ready'; prefill: ReceiptPrefill }
  | { kind: 'error'; code: ReceiptScanErrorCode; canRetry: boolean }
  | { kind: 'cancelled' };
```

Generate a new opaque request ID for each attempt. Every async completion checks the current request ID and selected-group generation before publishing state. Retake/cancel invalidates the generation, calls native cancellation when inference started, and runs ownership-aware cleanup. Late native results are discarded without parsing or navigation.

Mount the camera only while its route is focused and permission is granted. On app background, stop the preview and reject new captures; an in-flight prepared-image inference may finish only if the platform cannot cancel safely, but its result remains generation-guarded. On foreground, require the camera to report ready again before enabling capture.

The feature allows one active preparation/inference at a time and disables duplicate capture controls. A timeout may expose Cancel and manual-entry choices, but it must not destroy a working draft, start a second inference, or route to a network service.

### 21.8 Navigation and sanitized form handoff

Mockup 05 uses one split Add expense control:

- The larger labelled segment navigates directly to the unchanged manual Add expense route.
- The compact right segment is separated by a visible divider, has a minimum 44-by-44 touch target and accessible name **Scan receipt**, and opens `/expenses/scan`.

Do not put image URIs, OCR text, amounts, merchant names, dates, confidence, warnings, or serialized drafts in Expo Router parameters. Route parameters can appear in navigation history and developer diagnostics.

After successful parsing, convert only eligible results into:

```ts
interface ReceiptPrefill {
  description?: string;
  amountInput?: string;
  expenseDate?: CalendarDate;
  notice: 'receipt_scanned_locally';
  reviewMessages: string[]; // closed, content-free templates
}
```

`ReceiptDraftProvider.publish()` stores one sanitized value in memory, associated with the current normalized group key and an opaque attempt ID. The scanner cleans its files and raw inference data, then replaces itself with the Add expense route. `consume()` atomically returns and clears the matching prefill during form initialization. A missing/stale/mismatched value produces an ordinary empty manual form, never a partially reconstructed scan.

The expense form merges only `description`, `amount`, and `expenseDate` into its normal initial draft. Category and payment method remain null; payer, split type, and participants use existing defaults. The group currency remains authoritative. The form renders the local-scan notice and closed review messages, but saving calls the unchanged `buildNewExpense()` and `createExpense()` flow. A save/network failure preserves the ordinary editable form state without needing to retain the receipt image or OCR result.

### 21.9 Error, permission, and accessibility architecture

Map errors at the feature boundary into a closed `ReceiptScanErrorCode` union covering permission, camera availability, selection cancellation, image preparation, runtime/model status, malformed OCR output, no text, no reliable total, currency mismatch, date ambiguity, arithmetic inconsistency, memory pressure, inference failure, cancellation, and cleanup failure.

Permission behavior is explicit:

- `notDetermined`: explain the purpose and request only after member action.
- `denied` but requestable: offer Request camera access, Choose from photos, and Manual entry.
- permanently denied: offer operating-system settings guidance plus Photos and Manual alternatives.
- no camera: omit capture and keep Photos/Manual available.

The scanner announces runtime readiness, camera readiness, capture completion, each processing stage, cancellation, and the resulting review requirement without speaking recognized receipt content from a progress message. The preview is decorative once purpose/framing guidance is announced. Every control has a text accessibility label, and the split control exposes two independent actions rather than one ambiguous button.

Large text must preserve the header, privacy statement, capture/manual/photo actions, and camera touch target even if the decorative preview shrinks. Reduced motion removes any progress/capture animation; it does not change state timing or feedback. Light and dark themes style the overlay while preserving sufficient framing-guide contrast.

### 21.10 Security, privacy, and network isolation

Receipt content is more sensitive than the existing non-secret snapshot cache even though it does not contain authentication credentials. Apply these non-negotiable boundaries:

- Never write source/prepared images, raw OCR, extracted candidates, confidence, or corrections to SecureStore, AsyncStorage, SQLite, repository files, logs, analytics, crash reports, activity items, clipboard, notifications, or support payloads.
- Never include receipt content in thrown error messages, React keys, test IDs, route names/parameters, commit messages, or accessibility progress announcements.
- Never call `fetch`, Octokit, WebBrowser, or another network client from the receipt-scanning feature or native module.
- Keep model files read-only inside application resources; the first increment has no downloader, remote configuration, or runtime model update.
- Pass file URIs across the native bridge, not Base64 image data or pixel arrays in JavaScript.
- Limit dimensions, counts, text lengths, inference concurrency, and parser work before allocating derived structures.
- Clear the in-memory prefill on sign-out, terminal session expiry, group change, confirmed access loss, or process death.

The existing GitHub save remains a separate, member-triggered operation after review. Network monitors will still observe normal GitHub traffic when Save expense is pressed; privacy tests must distinguish that expected final expense request from the prohibited capture/OCR stages.

Release builds should disable receipt-content debug overlays. Development diagnostics may record request ID, phase, duration bucket, model-bundle version, safe error code, and aggregate block count only while actively debugging; they still must not record text, coordinates, amounts, dates, merchant, currency, URI, filesystem path, or image-derived thumbnails. Production telemetry remains absent under CR-006.

### 21.11 Local VLM extension point

Do not implement or bundle a vision-language model in the first PaddleOCR increment. Preserve a narrow future extension point only after the PRD section 21.9 decision gate passes:

```ts
interface LocalReceiptFallback {
  resolve(request: {
    requestId: string;
    imageUri: string;
    unresolvedFields: Array<'merchant' | 'date' | 'currency' | 'total'>;
  }): Promise<unknown>;
  cancel(requestId: string): Promise<void>;
}
```

A future local VLM receives only the prepared local image and the closed unresolved-field list. It returns schema-constrained candidates treated as untrusted `unknown`, and those candidates pass the same currency, date, amount, arithmetic, confidence, and confirmation rules. It cannot override a validated PaddleOCR field silently, write an expense, produce user-visible free-form advice, learn from corrections, or access a network client.

The fallback must not be resident concurrently with PaddleOCR if the approved memory budget cannot support both. A resource coordinator closes or releases the primary sessions/intermediates before loading the fallback and enforces one model pipeline at a time. Its model manifest, hashes, source, license, operators, device matrix, latency, memory, app-size impact, and airplane-mode proof require separate approval. If any gate fails, manual entry remains the only fallback.

### 21.12 Test architecture and feasibility benchmark

Keep all parser/validator tests platform-free and table-driven. Use synthetic OCR block fixtures rather than committed personal receipts. Cover English/Portuguese labels, reading order, coordinate ties, subtotal exclusion, multiple total lines, EUR/USD/GBP evidence, dot/comma/thousands conventions, safe-integer bounds, invalid/ambiguous dates, confidence thresholds, arithmetic tolerance, currency mismatch, malformed/oversized native output, and deterministic prefill.

Service/component tests inject fake camera, picker, image preparer, file manager, clock, ID source, and `ReceiptOcrPort`. Verify every state transition, duplicate capture suppression, retake/cancel, stale completion rejection, group/session generation changes, ownership-safe cleanup, one-time prefill consumption, no route data leakage, manual form defaults, review copy, save failure retention, permission alternatives, module/model errors, TalkBack labels, large text, dark/light themes, and reduced motion.

Native Android instrumentation tests use synthetic generated receipts and approved redacted/consented fixtures outside normal repository history when licensing/privacy requires it. Verify:

- model-manifest hashes and tensor/dictionary compatibility;
- exact preprocessing/postprocessing fixture outputs within documented numeric tolerance;
- quadrilateral mapping after resize/rotation/perspective correction;
- cancellation, repeated scans, session reuse, resource closure, and out-of-memory recovery;
- no networking API, dependency, or network use inside the native OCR module, and no receipt content in Logcat or exception messages.

The feasibility report records, per agreed device class and fixture condition:

```text
APK size delta
cold model-load time
warm scan time and percentile distribution
peak Java/native memory
crash and cancellation result
text-block accuracy
merchant/date/currency field accuracy
total exact-match rate
review/blank rate
```

Run the scanner in airplane mode and inspect Android network traffic from capture through form review. Exercise USB development through the documented `adb reverse tcp:8081 tcp:8081` and Expo localhost flow; a Metro download failure before JavaScript loads remains device-to-Metro connectivity, not an OCR inference failure.

No metric report contains receipt pixels or recognized/personal text. Thresholds advance only from the agreed privacy-safe benchmark; do not tune production confidence policy from ad hoc personal receipts that are later discarded without a reproducible fixture record.

### 21.13 Approval and implementation sequence

CR-006 is not authorized for implementation by this architecture update. After product review, proceed only in these gates:

1. **Feasibility spike:** outside production paths, prove model provenance/export, native runtime compatibility, fixture quality, airplane-mode execution, latency, memory, and APK-size impact on the device matrix.
2. **Architecture approval:** choose the exact PaddleOCR bundle, optional orientation stage, ONNX Runtime package/build, thresholds, minimum device, and distribution strategy; record the accepted manifest and benchmark.
3. **Pure contracts:** add strict OCR/result schemas, integer receipt parsing, validation/review policy, state machine, prefill contract, and exhaustive unit tests.
4. **Capture and cleanup:** add Expo packages/configuration, Development Build workflow, capture/photo selection, image preparation, ownership-aware file lifecycle, and permission/accessibility states.
5. **Android native module:** implement Kotlin detection/recognition, model resources, cancellation, resource closure, safe errors, and instrumentation tests.
6. **Form integration:** add the split Overview control from mockup 05, scanner route from mockup 13, ephemeral sanitized handoff, selective form prefill, and unchanged explicit save.
7. **Hardening and acceptance:** privacy/log/network inspection, corrupt/large inputs, low memory, backgrounding, repeated scans, TalkBack, themes, full validation, and the PRD section 21.13 manual matrix.
8. **Fallback decision:** evaluate a local VLM only from documented residual failures and treat approval as a separate product/security/performance decision.

Do not install dependencies, scaffold native modules, add model binaries, generate native projects, or change application routes before gates 1 and 2 are approved.

### 21.14 Explicitly outside the CR-006 architecture

- Receipt attachment/storage in GitHub, AsyncStorage, SQLite, activity history, or exports
- Item-level extraction, item categorization, inventory, warranties, nutrition, or merchant analytics
- Automatic category, payment-method, payer, participant, split, or save decisions
- Foreign-exchange conversion and multi-currency expenses
- Multiple-receipt queues, duplicate-receipt matching, or bookkeeping reconciliation
- Cloud OCR, hosted VLMs, remote human review, telemetry, training, or correction upload
- Runtime model downloads, remote model configuration, or silent model replacement
- Production local VLM support before the separate gate passes
- iOS delivery until the product supports iOS; later Swift behavior must match the same contract and fixtures

These require new product and architecture decisions rather than expansion during implementation.
