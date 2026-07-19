# BranchBalance — Phase 1 Product Requirements Document

**Status:** Phase 1 and CR-001 implemented; physical-device acceptance pending

**Last updated:** 2026-07-18

**Platform:** Android

**Repository prefix:** `branch-balance`

**Active change requests:** CR-001 — Trip and group spending intelligence

## 1. Product summary

BranchBalance is a GitHub-backed expense-sharing app for two or more people. Each group is represented by a private GitHub repository. GitHub provides identity, membership, persistence, and sharing; BranchBalance has no application backend in Phase 1.

Members can add, edit, and delete shared expenses, choose who paid and who participates in each expense, and see the resulting balances. Phase 1 is always-online and uses the GitHub REST API directly from the mobile app.

## 2. Phase 1 goal

Prove the complete product loop on physical Android devices:

1. A user installs the app and signs in with GitHub.
2. The user creates a group, backed by a private GitHub repository.
3. The user invites another GitHub user.
4. The invited user accepts through GitHub, signs in, and sees the group.
5. Either member can add, edit, and delete expenses.
6. Both members see up-to-date totals and a simplified settlement list.
7. Expired access tokens refresh without requiring the user to sign in again while the refresh token remains valid.

Phase 1 is complete when this loop works reliably in a locally built, sideloadable APK.

## 3. Confirmed product decisions

| Area | Decision |
|---|---|
| App and repository prefix | `branch-balance` |
| Group visibility | Repositories are always private |
| Currency | One currency per group; default is EUR |
| Expense splits | Equal and full-to-one |
| Expense lifecycle | Add, edit, and delete |
| Synchronization | Refresh on screen load/focus and app foreground; also support pull-to-refresh |
| Authentication | Expiring GitHub App user tokens with refresh-token rotation |
| Backend | None in Phase 1 |
| Target platform | Android only |

## 4. Scope

### 4.1 Included

- GitHub App installation and device-flow sign-in
- Secure access-token and refresh-token storage
- Automatic token refresh
- Private group repository creation
- Group discovery from GitHub App installations
- GitHub collaborator invitations and accepted-member discovery
- Expense creation, editing, and deletion
- Equal and full-to-one splits
- Expense list, per-member totals, net balances, and simplified settlements
- Automatic foreground/screen refresh and manual pull-to-refresh
- Clear loading, empty, authentication, permission, conflict, rate-limit, and network states
- A locally built APK that runs on a physical Android device

### 4.2 Not included

- Offline writes, local Git clones, or `isomorphic-git`
- Settlement recording or marking debts as paid
- Exact-amount or percentage split controls
- Multiple currencies within a group or foreign-exchange conversion
- Push notifications or background synchronization
- Member removal or group deletion
- Receipt images or attachments
- iOS builds
- Organization-owned groups; Phase 1 supports repositories owned by personal GitHub accounts

## 5. Users, membership, and permissions

- Any person with a GitHub account can sign in.
- The group creator owns the private repository and is always a group member.
- Accepted repository collaborators with write access are group members.
- Pending repository invitations are displayed separately and do not count as members until accepted.
- GitHub remains the source of truth for membership. BranchBalance must not persist a duplicate member list in `group.json`.
- Any accepted member with write access may add, edit, or delete any expense in Phase 1.
- The repository owner manages invitations. If another member lacks repository administration permission, the invite action is hidden or disabled.

The GitHub App requires these repository permissions:

- **Metadata: read**
- **Contents: read and write**
- **Administration: read and write** for private repository creation and collaborator management

Installation and authorization are distinct GitHub actions. The group creator must install the GitHub App on their personal account and authorize it. For the Phase 1 creation flow, the installation must cover all repositories so newly created group repositories are immediately accessible to the app. Invited collaborators authorize the app, but do not need to install it on their own account to access a group covered by the owner's installation.

## 6. Functional requirements

### 6.1 Install and sign in

1. On first launch, the app checks for a stored session.
2. If the user has not authorized the GitHub App, the app starts GitHub's device flow.
3. The app displays the user code, provides a copy action, and opens `https://github.com/login/device`.
4. The app polls at GitHub's supplied interval and handles `authorization_pending`, `slow_down`, expiry, cancellation, and denial.
5. After authorization, the app fetches `GET /user` and stores the username and avatar URL locally.
6. The app verifies that the relevant GitHub App installation is accessible. If the user wants to create groups but has not installed the app, it opens the GitHub App installation page and explains the required repository access.

The signed-in state persists across app restarts. A user can explicitly sign out, which clears all locally stored tokens and cached account/group data.

### 6.2 Token lifecycle

GitHub App user access token expiration remains enabled.

- Store the access token, refresh token, access-token expiry, and refresh-token expiry in `expo-secure-store`.
- Refresh the access token shortly before expiry and before an authenticated request when it is already expired.
- Refresh with `POST https://github.com/login/oauth/access_token`, using `client_id`, `grant_type=refresh_token`, and `refresh_token`.
- Do not ship a GitHub client secret. GitHub does not require it when the original user token was generated by device flow.
- Replace both stored tokens atomically after every successful refresh because refresh tokens rotate.
- Permit only one refresh request at a time; concurrent API calls await the same refresh operation.
- On an unexpected `401`, refresh once and retry the original request once.
- If refresh fails because the refresh token is invalid, expired, or revoked, clear the session and restart device-flow sign-in. Do not loop retries.

GitHub currently issues access tokens for 8 hours and refresh tokens for 6 months. The implementation must use the expiry values returned by GitHub rather than hardcoding those durations.

### 6.3 Discover groups

On app launch, app foreground, and whenever the group-list screen gains focus:

1. Fetch `GET /user/installations`.
2. For each accessible installation, fetch `GET /user/installations/{installation_id}/repositories`, following pagination.
3. Keep private repositories whose names start with `branch-balance-`.
4. Read and validate each candidate's `group.json`; only valid BranchBalance repositories appear as groups.

The app may render cached groups immediately, but must show that a refresh is in progress. It must deduplicate overlapping lifecycle refreshes and expose pull-to-refresh. Refresh failures leave the last successful data visible with an error and retry action.

### 6.4 Create a group

The user enters:

- Group name, required
- Currency selected from the Phase 1 supported-currency list, default `EUR`

On submit:

1. Trim and validate the name.
2. Slugify it and create `branch-balance-<slug>` with `POST /user/repos` and `private: true`.
3. If the name already exists, show an actionable error and let the user change the group name; do not silently attach to the existing repository.
4. Create `group.json` on the repository's actual default branch.
5. Add the new group to local state and open it.

If repository creation succeeds but `group.json` creation fails, report a partial-creation error with a retry action. Group discovery ignores the repository until it has a valid `group.json`.

An empty `expenses/` directory is not required. GitHub creates the path when the first expense file is added.

### 6.5 Invite and view members

- The owner enters a GitHub username and taps **Invite**.
- The app calls `PUT /repos/{owner}/{repo}/collaborators/{username}` with write access.
- The app reads pending invitations from `GET /repos/{owner}/{repo}/invitations` and accepted members from `GET /repos/{owner}/{repo}/collaborators`.
- The UI distinguishes **Pending** from **Member**.
- The invitee accepts through GitHub's notification, email, or website.
- The next automatic or manual refresh reflects the accepted membership.

The form rejects the owner's username, an accepted member, and an already-pending username. GitHub errors such as unknown users, permission restrictions, and invitation rate limits are shown in plain language.

### 6.6 Add an expense

The form contains:

- Description: required, trimmed, 1–120 characters
- Amount: required, greater than zero, with no more fractional digits than the selected currency supports (two for EUR)
- Paid by: required; defaults to the signed-in user and may be any accepted member
- Split type: required
- Participants: required according to the selected split type

Split types:

- **Equal:** one or more accepted members share the cost; all accepted members are selected by default. The payer may be included or excluded.
- **Full-to-one:** exactly one accepted member other than the payer owes the full amount.

Amounts are converted to integer minor units before persistence. For an equal split that does not divide evenly, sort participant usernames case-insensitively and assign one remainder unit to each participant from the start of that list until the remainder is exhausted. Persist the resulting shares so every device computes the same balance.

On submit, write `expenses/<uuid>.json`. Disable duplicate submissions while the request is in flight. After success, update local state and recompute balances without waiting for another refresh.

### 6.7 Edit an expense

- Any accepted member with write access can open an existing expense and choose **Edit**.
- The edit form has the same validation and split rules as creation.
- Preserve `id`, `created_by`, and `created_at`; set `updated_by` and `updated_at`.
- Update the same file through the Contents API and include the file's latest blob SHA for optimistic concurrency.
- If GitHub reports a stale SHA or conflicting update, do not overwrite remote data. Fetch the latest expense and ask the user to review and reapply their changes.
- After success, replace the local expense and recompute balances immediately.

### 6.8 Delete an expense

- Any accepted member with write access can choose **Delete** from the expense detail or overflow menu.
- Require a confirmation that names the expense and amount.
- Delete the file through the Contents API using its latest SHA.
- Handle a stale SHA like an edit conflict; if the file is already absent, treat the local expense as deleted after confirming with GitHub.
- After success, remove it from local state and recompute balances immediately.

Deletion is permanent in the app. Git history remains GitHub's audit trail, but Phase 1 provides no restore interface.

### 6.9 View expenses and balances

The group screen shows:

- Group name and currency
- Accepted and pending members
- Expenses, newest first
- Description, amount, payer, split summary, creator, and creation/update time for each expense
- Total paid by each member
- Net balance for each member
- Simplified settlements such as “Bob owes Alice €23.50”

The screen refreshes whenever it loads or regains focus and when the app returns to the foreground. Pulling down from the top starts the same refresh. Only one group refresh may run at a time.

## 7. Data model

### 7.1 Repository layout

```text
branch-balance-<group-slug>/
├── group.json
└── expenses/
    ├── <uuid>.json
    └── <uuid>.json
```

All reads and writes use the repository's reported default branch; never assume it is named `main`.

### 7.2 `group.json`

```json
{
  "schema_version": 1,
  "name": "Road trip 2026",
  "currency": "EUR",
  "created_by": "octocat",
  "created_at": "2026-07-16T12:00:00Z"
}
```

Rules:

- `schema_version` must equal `1` in Phase 1.
- `currency` is an uppercase ISO 4217 code from the app's supported-currency list and cannot be changed after the first expense is created.
- Timestamps are UTC ISO 8601 strings generated by the client.

### 7.3 Expense file

```json
{
  "schema_version": 1,
  "id": "6f2c1a3e-2b1d-4a3a-9c3e-9d2f9a0b1234",
  "description": "Dinner at Nando's",
  "amount_minor": 4250,
  "currency": "EUR",
  "paid_by": "octocat",
  "split_type": "equal",
  "participants": ["monalisa", "octocat"],
  "shares_minor": {
    "monalisa": 2125,
    "octocat": 2125
  },
  "created_by": "octocat",
  "created_at": "2026-07-16T18:32:00Z",
  "updated_by": null,
  "updated_at": null
}
```

Invariants:

- The filename UUID equals `id`.
- `amount_minor` is a positive integer.
- `currency` equals the group's currency.
- `participants` contains unique, accepted member usernames.
- The keys of `shares_minor` exactly match `participants`.
- Every share is a non-negative integer and all shares sum exactly to `amount_minor`.
- For `full`, there is exactly one participant, that participant is not the payer, and their share equals `amount_minor`.
- Unknown fields are ignored for forward compatibility; invalid files are excluded from balances and surfaced as a data warning.

## 8. Balance computation

Use integer minor units throughout; never calculate persisted money with binary floating-point values.

```text
balance = 0 for every accepted member and every username referenced by an expense
total_paid = 0 for the same usernames

for each valid expense:
    total_paid[expense.paid_by] += expense.amount_minor
    balance[expense.paid_by] += expense.amount_minor

    for each (person, share) in expense.shares_minor:
        balance[person] -= share
```

- Positive balance: the member is owed money.
- Negative balance: the member owes money.
- Zero balance: settled overall.
- Former or otherwise missing collaborators referenced by historical expenses remain in calculations under their stored username.
- The sum of all net balances must be zero; otherwise show a data-integrity warning.

To produce a concise settlement list:

1. Sort debtors by most negative balance, then username.
2. Sort creditors by most positive balance, then username.
3. Transfer the smaller of the current debtor's absolute debt and creditor's credit.
4. Remove zeroed entries and continue until both lists are empty.

All ordering tie-breaks must be deterministic so different devices show the same result.

## 9. Synchronization and conflict behavior

Phase 1 is online-only. GitHub is authoritative; local state is a cache.

- Trigger refresh on group-list/group-screen focus, initial screen load, app foreground, and pull-to-refresh.
- Coalesce simultaneous triggers into one in-flight request per resource.
- Fetch the repository tree recursively, select `expenses/*.json`, and fetch blobs with bounded concurrency.
- Do not clear valid cached data while a refresh is pending or when a transient refresh fails.
- Apply a refresh result as one state update so expenses and balances do not briefly disagree.
- Use blob SHAs for edit and delete preconditions.
- Never resolve a conflict with last-write-wins silently.
- Creating expenses uses UUID filenames, making independent concurrent creates non-conflicting.

Editing and deleting mutable files means the Phase 1 format is not fully conflict-free for future offline writes. Phase 2 must either add revision/tombstone events or define a merge strategy before enabling offline mutation.

## 10. GitHub API surface

| Action | Endpoint |
|---|---|
| Start device flow | `POST https://github.com/login/device/code` |
| Complete/poll device flow | `POST https://github.com/login/oauth/access_token` |
| Refresh user token | `POST https://github.com/login/oauth/access_token` |
| Get current user | `GET /user` |
| List accessible installations | `GET /user/installations` |
| List repositories for installation | `GET /user/installations/{installation_id}/repositories` |
| Create private repository | `POST /user/repos` |
| Read/create/update file | `GET /repos/{owner}/{repo}/contents/{path}` / `PUT /repos/{owner}/{repo}/contents/{path}` |
| Delete expense file | `DELETE /repos/{owner}/{repo}/contents/{path}` |
| List accepted members | `GET /repos/{owner}/{repo}/collaborators` |
| Invite member | `PUT /repos/{owner}/{repo}/collaborators/{username}` |
| List pending invitations | `GET /repos/{owner}/{repo}/invitations` |
| List expense files | `GET /repos/{owner}/{repo}/git/trees/{tree_sha}?recursive=1` |
| Fetch expense content | `GET /repos/{owner}/{repo}/git/blobs/{file_sha}` |

Use GitHub's recommended media type and pin a supported `X-GitHub-Api-Version` header in one shared API client. Follow pagination and surface primary/secondary rate-limit errors with a retry time when GitHub supplies one.

## 11. Application architecture

- **React Native + Expo**, managed workflow
- **TypeScript** with strict mode
- **`@octokit/rest`** for GitHub REST calls
- Device-flow/refresh handling behind a dedicated authentication service; use `@octokit/auth-oauth-device` where it supports the required token metadata and rotation behavior
- **`expo-secure-store`** for tokens only
- **`expo-router`** for navigation
- React Context and hooks for session and small shared state; avoid a global state library until complexity requires one
- A pure domain layer for schema validation, equal-share allocation, balance calculation, and debt simplification
- Local cache for non-secret group/account data; secure storage must not be treated as a general database
- Local Android build through EAS, producing a sideloadable APK

Suggested routes:

```text
/(auth)/sign-in
/(app)/groups
/(app)/groups/new
/(app)/groups/[owner]/[repo]
/(app)/groups/[owner]/[repo]/expenses/new
/(app)/groups/[owner]/[repo]/expenses/[id]
/(app)/groups/[owner]/[repo]/expenses/[id]/edit
```

## 12. Error and empty states

At minimum, provide explicit UI for:

- No GitHub App installation / installation does not cover repositories
- Device code expired, authorization denied, or sign-in cancelled
- Refresh token expired or revoked
- No groups
- Group has no expenses
- Group has only one accepted member
- Repository name collision
- Partial group creation
- Invitation pending, rejected, restricted, or rate-limited
- Network unavailable or request timed out
- GitHub primary or secondary rate limit reached
- User lost repository access
- Expense changed or was deleted on another device
- Malformed `group.json` or expense files

Retry actions must be safe and must not create duplicate expenses or repositories.

## 13. Acceptance criteria

- [ ] A user can install/authorize the GitHub App and sign in through device flow on a physical Android device.
- [ ] Access and refresh tokens are stored securely; an expired access token refreshes and the interrupted request succeeds without user interaction.
- [ ] An expired, invalid, or revoked refresh token returns the user to sign-in with a clear explanation.
- [ ] A user can create a private `branch-balance-<slug>` repository containing a valid `group.json`, with EUR selected by default.
- [ ] A repository without a valid `group.json` is not presented as a group.
- [ ] The owner can invite a second GitHub account and see its pending state.
- [ ] After accepting the GitHub invitation and authorizing BranchBalance, the second account sees the group.
- [ ] Either member can add an equal-split or full-to-one expense.
- [ ] Uneven equal splits allocate every cent deterministically and all shares sum to the expense amount.
- [ ] Either member can edit an expense; balances update and a concurrent remote edit is not silently overwritten.
- [ ] Either member can confirm and delete an expense; it disappears and balances update.
- [ ] Each active expense is stored as `expenses/<uuid>.json` and passes schema validation.
- [ ] The group screen shows expenses, total paid per member, net balances, and deterministic simplified settlements.
- [ ] Group data refreshes on screen load/focus and app foreground.
- [ ] Pull-to-refresh is available on both the group list and group detail screen.
- [ ] A failed refresh preserves the last successful data and offers retry.
- [ ] A signed APK built locally on macOS installs and runs on a physical Android phone.

## 14. Test requirements

### 14.1 Unit tests

- Currency input to minor-unit conversion
- Equal allocation with and without a remainder
- Full-to-one allocation
- Expense and group schema validation
- Balance totals and zero-sum invariant
- Deterministic debt simplification
- Token-expiry decisions and single-flight refresh behavior

### 14.2 Integration tests with mocked GitHub responses

- Device-flow polling states
- Successful token rotation and failed refresh fallback
- Installation and paginated group discovery
- Group creation and partial bootstrap failure
- Invitation pending-to-accepted transition
- Expense create, edit, delete, and stale-SHA conflicts
- Lifecycle refresh deduplication and stale-cache preservation
- Rate-limit and permission errors

### 14.3 Manual device test

Run the complete Phase 1 goal with two real GitHub accounts and at least two physical app sessions. Include an access-token refresh, an uneven three-person split, an edit conflict, a delete, app foreground refresh, and pull-to-refresh.

## 15. Phase 2 candidates

- Offline-first local Git clone and `isomorphic-git` synchronization
- Immutable revision/tombstone events for offline-safe edits and deletes
- Settlement recording
- Exact-amount and percentage splits
- Multi-currency groups and FX conversion
- Member removal and group deletion
- Receipt attachments
- iOS support
- Push notifications, which would require revisiting the no-backend constraint

## 16. Change request CR-001 — Trip and group spending intelligence

**Status:** Implemented; physical-device acceptance pending

**Requested:** 2026-07-17

**Target:** First post-Phase-1 product increment; release name to be decided

### 16.1 Context and motivation

Phase 1 answers the settlement question: who paid, who participated, and who owes whom. CR-001 extends BranchBalance into a shared spending companion that also answers:

- How much has the group spent?
- Where did the money go?
- Is the group above or below its budget?
- How much remains available for the rest of a trip?
- Was an expense paid by card or cash?

The primary use case is a shared vacation or trip, but the design must remain useful for events, households, couples, and other groups. Travel-specific dates and pacing are optional. A group without dates continues to work as a general-purpose expense group.

This change is additive. It does not alter Phase 1 balance calculations, settlement simplification, GitHub membership, one-currency-per-group behavior, or the no-backend architecture.

### 16.2 Product outcome

BranchBalance must provide one coherent spending-intelligence experience rather than a set of unrelated metadata fields. Categories describe where money went, the budget establishes the group's target, trip dates provide time context, and payment method describes how the payer funded the purchase.

The selected-group experience gains a **Spending** tab. The Overview tab retains a compact budget summary, while Spending provides the detailed budget, category, payment-method, and trip-pacing views.

### 16.3 Confirmed decisions

| Area | Decision |
|---|---|
| Budget basis | The group budget measures all valid tracked expenses, including payer-only “Just me” expenses |
| Individual context | Show “You paid” and “Your share” separately; neither value replaces total group spending |
| Budget type | One optional, one-time budget per group in the group's existing currency |
| Category budgets | Optional limits per category; they do not need to add up to the total budget |
| Budget enforcement | Informational only; reaching or exceeding a budget never blocks an expense |
| Categories | Fixed taxonomy with a general-purpose `other` option; no custom categories in CR-001 |
| Payment methods | `card`, `cash`, and `other`; store no card, bank, or wallet identifiers |
| Personal spending | “Just me” is a form shortcut represented by an equal split whose only participant is the payer |
| Trip context | Optional inclusive start and end calendar dates enable remaining-per-day guidance |
| Permissions | Any accepted member with write access may update the shared spending plan |
| Balance impact | Category, budget, dates, and payment method never change shares, balances, or settlements |
| Data visibility | All spending-plan and expense metadata is shared with group members through the private repository |
| Compatibility | Existing groups and expenses remain valid and receive explicit legacy presentation states |

### 16.4 Expense categories

CR-001 defines this persisted category taxonomy:

| Value | Display label | Examples |
|---|---|---|
| `accommodation` | Accommodation | Hotel, hostel, rental home |
| `food_drink` | Food & drinks | Restaurants, cafés, bars |
| `groceries` | Groceries | Supermarket and shared supplies |
| `transport` | Transport | Flights, rail, taxis, fuel, parking |
| `activities` | Activities | Tours, tickets, museums, entertainment |
| `shopping` | Shopping | Souvenirs and retail purchases |
| `fees` | Fees | Tourist taxes, booking fees, service charges |
| `other` | Other | Valid spending that does not fit another category |

New expenses require a category. The form must make the choice fast with accessible labelled controls and a distinct icon or visual marker. Meaning must not depend on colour alone.

An existing expense without `category` is valid and appears as **Uncategorized**. `Uncategorized` is a derived legacy state, not a value that new clients persist. When a member edits a legacy expense, the form requires them to choose one of the persisted categories before saving.

The expense list supports category filtering and displays the category on every row and detail screen. The Spending tab shows the amount and percentage of total tracked spending in each category, including a separate Uncategorized row while legacy expenses remain.

### 16.5 Group budget and category limits

A group may operate without a budget. Any accepted member may open group spending settings and configure, update, or remove:

- One total group budget in positive integer minor units
- Optional positive limits for one or more persisted categories
- Optional trip start and end dates as described in section 16.6

Budget calculations use active, valid expenses only:

```text
total_spent = sum(expense.amount_minor)
remaining = budget_minor - total_spent
category_spent[category] = sum(amount_minor for expenses in category)
current_user_share = sum(expense.shares_minor[current_user])
current_user_paid = sum(amount_minor for expenses paid by current_user)
```

- Positive `remaining` means the group is under budget.
- Zero `remaining` means the group is exactly at budget.
- Negative `remaining` means the group is over budget by its absolute value.
- Payer-only “Just me” expenses count toward `total_spent` and their category total even though they create no debt.
- Uncategorized legacy expenses count toward the total budget but not toward any configured category limit.
- Category limits are independent guidance. Their sum may be below or above the total budget and does not change the total budget.
- Adding, editing, or deleting an expense recalculates every affected value immediately after the remote mutation succeeds.

The UI must show spent, remaining or over-budget amount, and percentage used. An over-budget state must include text and cannot rely on colour alone. Budget status never disables or rejects expense creation.

### 16.6 Optional trip dates and daily guidance

A group may define both `starts_on` and `ends_on`, or neither. Dates are calendar facts in `YYYY-MM-DD` format and are inclusive. `ends_on` must be on or after `starts_on`.

When both a total budget and trip dates exist, BranchBalance shows remaining-per-day guidance:

```text
if today < starts_on:
    available_days = inclusive days from starts_on through ends_on
else if today <= ends_on:
    available_days = inclusive days from today through ends_on
else:
    available_days = 0

if available_days > 0:
    daily_available = max(remaining, 0) / available_days
```

Round `daily_available` down to whole minor units for display so the guidance does not imply that more money is available than remains. Expenses paid before the trip still count against the budget. During the trip, the calculation therefore answers how much of the remaining budget is available across the remaining days.

- Before the trip, label the value **Planned per day**.
- During the trip, show the current inclusive day, total trip days, and **Available per remaining day**.
- After the trip, show final under-budget or over-budget performance and omit a daily allowance.
- If dates or a total budget are absent, omit daily guidance without showing an error.
- Device-local calendar date determines `today`; no timezone conversion is applied to stored trip dates.

### 16.7 Payment method

New expenses require one payment method:

- **Card**
- **Cash**
- **Other**

Payment method describes how `paid_by` funded the expense. It does not identify a card or financial account and has no effect on balances.

An existing expense without `payment_method` remains valid and appears as **Unspecified**. `Unspecified` is a derived legacy state and cannot be persisted by new clients. Editing a legacy expense requires a persisted payment method before saving.

The expense list and detail view display payment method. The Spending tab shows total tracked spending by payment method, including Unspecified while necessary, and supports filtering expenses by method. BranchBalance must never request or store a card number, card suffix, bank name, account identifier, or wallet credential as part of CR-001.

### 16.8 “Just me” expense shortcut

The split selector gains a **Just me** option. It is a presentation shortcut, not a new persisted split type:

```json
{
  "paid_by": "octocat",
  "split_type": "equal",
  "participants": ["octocat"],
  "shares_minor": {
    "octocat": 4250
  }
}
```

This expense increases total and category spending but leaves every net balance unchanged. If the payer changes while Just me is selected, the sole participant and full share change to the new payer. The UI explains that the expense is visible to the group and counts toward the shared budget even though nobody owes the payer.

### 16.9 Spending experience

The selected-group navigation adds **Spending** alongside Overview, Balances, and Members.

Overview shows a compact summary when a budget exists:

- Total budget
- Total spent
- Remaining or over-budget amount
- Percentage used
- Remaining-per-day guidance when available

The full Spending tab shows:

- Total budget progress, or an invitation to set a budget
- Group total spent
- Current user's paid total and attributable share
- Remaining or over-budget amount
- Trip dates and remaining-per-day guidance when configured
- Spending by category with category-limit progress where configured
- Spending by payment method
- Filters for category, payment method, payer, and shared versus Just me expenses
- Explicit empty states when no expenses or no budget exist

Charts are optional presentation enhancements. Every value represented graphically must also be available as text and exposed accessibly. The first implementation must prioritize understandable totals and progress over complex visualization.

### 16.10 User stories

#### US-CR001-01 — Categorize an expense

As a group member, I want to assign a category when adding or editing an expense so that the group can understand where its money went.

#### US-CR001-02 — Set a group budget

As a group member, I want to set an optional total budget so that everyone can see whether tracked spending is under or over the agreed amount.

#### US-CR001-03 — Set category limits

As a group member, I want to set optional category limits so that the group can monitor areas such as accommodation, food, and transport independently.

#### US-CR001-04 — Follow trip spending pace

As a traveller, I want to add trip dates and see how much remains available per day so that the group can adjust its spending before the trip ends.

#### US-CR001-05 — Record card or cash

As a group member, I want to record whether an expense was paid by card, cash, or another method so that the group can understand and filter how purchases were funded.

#### US-CR001-06 — Track personal trip spending

As a group member, I want a Just me shortcut so that personal spending can contribute to the trip budget without creating a debt for another member.

#### US-CR001-07 — Review spending insights

As a group member, I want one Spending view that combines budget, category, payment-method, and personal-share information so that I do not need to calculate trip status manually.

#### US-CR001-08 — Continue using an existing group

As a member of a group created before CR-001, I want its existing expenses and balances to remain usable even when category and payment-method metadata is absent.

### 16.11 Persistence changes

`group.json` may add an optional `spending_plan` object while retaining `schema_version: 1`:

```json
{
  "schema_version": 1,
  "name": "Road trip 2026",
  "currency": "EUR",
  "spending_plan": {
    "budget_minor": 200000,
    "category_budgets_minor": {
      "accommodation": 80000,
      "food_drink": 40000,
      "transport": 25000
    },
    "starts_on": "2026-08-10",
    "ends_on": "2026-08-16",
    "updated_by": "octocat",
    "updated_at": "2026-07-17T14:00:00Z"
  },
  "created_by": "octocat",
  "created_at": "2026-07-16T12:00:00Z"
}
```

Rules:

- `spending_plan` is optional.
- It must contain a total budget, a valid date pair, or both.
- `budget_minor` is optional but, when present, is a positive safe integer.
- `category_budgets_minor` is optional and is allowed only when `budget_minor` exists.
- Every category limit is a positive safe integer keyed by a persisted category value.
- `starts_on` and `ends_on` must either both exist or both be absent.
- `updated_by` and `updated_at` are required whenever `spending_plan` exists.
- Removing the spending plan removes the object rather than persisting empty or null fields.
- Updates to `group.json` include its latest blob SHA. A stale SHA produces the same review-and-reapply conflict behavior used for expense edits.

New expense writes add `category` and `payment_method` while retaining `schema_version: 1`:

```json
{
  "schema_version": 1,
  "id": "6f2c1a3e-2b1d-4a3a-9c3e-9d2f9a0b1234",
  "description": "Dinner at Nando's",
  "amount_minor": 4250,
  "currency": "EUR",
  "category": "food_drink",
  "payment_method": "card",
  "paid_by": "octocat",
  "split_type": "equal",
  "participants": ["monalisa", "octocat"],
  "shares_minor": {
    "monalisa": 2125,
    "octocat": 2125
  },
  "expense_date": "2026-07-16",
  "created_by": "octocat",
  "created_at": "2026-07-16T18:32:00Z",
  "updated_by": null,
  "updated_at": null
}
```

The additions are backward-compatible within schema version 1 because current readers already ignore unknown fields. CR-001 readers accept missing `category` and `payment_method` only for legacy files and derive the presentation states described above. CR-001 writers always include both fields and preserve them during edits.

### 16.12 Synchronization and cache impact

- Group snapshots include the validated spending plan and all derived spending summaries.
- Group-list cached summaries may include budget progress, but mixed currencies across different groups remain separated as required by the existing architecture.
- Refresh applies expenses, balances, budget values, and spending summaries as one state update so the tabs cannot temporarily disagree.
- Invalid spending-plan data produces a safe group data warning. It does not invalidate otherwise valid expenses or balances.
- Invalid category or payment method on an expense makes that expense invalid under the same warning and exclusion rules as other malformed expense data.
- Concurrent spending-plan edits use optimistic concurrency and are never silently overwritten.

### 16.13 Acceptance criteria

- [ ] An accepted member can add an expense with one persisted category and one persisted payment method.
- [ ] An accepted member can edit category and payment method without changing the expense's shares or resulting balances.
- [ ] Existing expenses without the new fields remain visible, valid for balances, and clearly labelled Uncategorized and Unspecified.
- [ ] Category totals equal the sum of active valid expenses shown in each category.
- [ ] Payment-method totals equal the sum of active valid expenses shown for each method.
- [ ] Any accepted member can set, edit, or remove an optional group budget.
- [ ] Any accepted member can configure optional category limits that do not have to equal the total budget.
- [ ] Total spent includes shared and Just me expenses and excludes deleted or invalid expenses.
- [ ] The UI distinguishes total group spending, current-user paid total, and current-user share.
- [ ] Under-budget, at-budget, and over-budget states show the correct amount and do not rely on colour alone.
- [ ] Exceeding a total or category budget does not block adding or editing an expense.
- [ ] A group can save a valid inclusive trip date range, and invalid or partial ranges are rejected.
- [ ] Remaining-per-day guidance follows section 16.6 before, during, and after the trip.
- [ ] A Just me expense counts toward spending while leaving all net balances unchanged.
- [ ] Changing the payer on a Just me draft updates its sole participant and share.
- [ ] Overview shows a compact budget summary and Spending shows the complete breakdown.
- [ ] Expense filters can combine category, payment method, payer, and shared/Just me scope without modifying stored data.
- [ ] A stale concurrent spending-plan update is not silently overwritten.
- [ ] No CR-001 screen requests or stores identifying card or bank information.
- [ ] Two physical Android sessions reading the same repository derive the same totals and budget state.

### 16.14 Test requirements

Unit coverage must include:

- Category and payment-method schema validation
- Legacy missing-field fallbacks
- Total, category, and payment-method aggregation
- Shared versus Just me classification
- Budget remaining and percentage calculations
- Inclusive date and remaining-day calculations before, during, and after a trip
- Minor-unit rounding for daily guidance
- The invariant that metadata changes do not change balances

Integration coverage with mocked GitHub responses must include:

- Reading groups with no spending plan
- Creating, updating, removing, and conflicting on a spending plan
- Adding and editing categorized card/cash expenses
- Loading a mixture of legacy and CR-001 expense files
- Immediate recalculation after expense create, edit, and delete
- Cache hydration followed by a remote spending-plan change
- Combined expense filters and their empty states

The manual two-account Android test must add a budget and trip dates, record card and cash expenses in different categories, add a Just me expense, exceed one category limit, edit the spending plan from both sessions to produce a conflict, and verify identical totals after refresh.

### 16.15 Explicitly deferred from CR-001

- Custom or user-created categories
- Recurring weekly or monthly budgets
- Private per-user budgets hidden from other group members
- Planned or forecast expenses that have not yet been paid
- Cash withdrawals, cash-on-hand balances, or shared cash wallets
- Automatic category prediction
- Card or bank transaction import
- Receipt scanning or itemization
- Budget push notifications or background alerts
- Multi-currency budgeting or foreign-exchange conversion
- Offline writes or offline conflict resolution

These remain candidates for later product changes and require separate requirements before implementation.

## 17. Technical references

- [Generating a user access token for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [Refreshing GitHub App user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens)
- [GitHub App installation endpoints](https://docs.github.com/en/rest/apps/installations)
- [Repository endpoints](https://docs.github.com/en/rest/repos/repos)
- [Repository collaborator endpoints](https://docs.github.com/en/rest/collaborators/collaborators)
