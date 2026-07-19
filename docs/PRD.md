# BranchBalance — Phase 1 Product Requirements Document

**Status:** Phase 1, CR-001, and CR-002 implemented; physical-device acceptance pending

**Last updated:** 2026-07-19

**Platform:** Android

**Repository prefix:** `branch-balance`

**Active change requests:** None; CR-001 and CR-002 are implemented

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

## 17. Change request CR-002 — Settlement payment recording

**Status:** Implemented; physical two-account acceptance pending

**Requested:** 2026-07-19

**Target:** Next post-v1.0.0 product increment; release name to be decided

### 17.1 Context and motivation

Phase 1 and CR-001 derive deterministic suggested settlements from expenses, but they cannot record that money has actually moved. A group that follows a suggestion therefore continues to show the same debt, has no shared payment history, and must adjust balances outside BranchBalance.

CR-002 closes that loop. It lets a member record all or part of a current suggested settlement as pending, requires the named recipient to confirm that the money was received before balances change, and retains a clear history that every member can review.

This change is additive. It does not initiate a bank, card, cash, or wallet transfer. It records a transfer that happened elsewhere and does not alter expense documents, expense shares, spending totals, budgets, categories, or payment-method analytics.

### 17.2 Product outcome

The Balances experience must move from advice-only settlement text to an actionable and auditable workflow:

1. BranchBalance derives the current suggested transfers from expenses and previously recorded settlement payments.
2. A member opens one suggestion and records its full amount or a smaller positive partial amount.
3. The app reviews the sender, recipient, amount, payment date, and optional note before creating a pending payment.
4. The recipient reviews the pending payment and explicitly confirms that the money was received.
5. Only that confirmation changes balances and the remaining suggestions.
6. Every member can review pending and confirmed payment history and remove an incorrect record.

### 17.3 Confirmed decisions

| Area | Decision |
|---|---|
| Creation entry point | A payment is recorded from a current suggested settlement; CR-002 does not provide an arbitrary member-to-member transfer form |
| Amount | Prefill the full unreserved suggestion amount and allow a smaller positive partial amount |
| Overpayment | Reject an amount above the current suggested amount after pending reservations for that sender and recipient are subtracted |
| Confirmation | Every new payment is pending and affects balances only after the named recipient confirms receipt |
| Permissions | Any accepted member with repository write access may record or delete a payment; only the current accepted recipient may confirm it |
| Sender and recipient | Fixed by the selected suggestion and cannot be changed in the form |
| Payment date | Default to the device-local current date; allow an earlier valid calendar date but not a future date |
| Correction | Payments are not edited; delete the incorrect record and create a replacement from a current suggestion |
| Balance impact | Only confirmed payments change net balances and future suggestions; pending and confirmed payments never change expense-paid totals, shares, group spending, or budgets |
| Pending reservation | Pending amounts reserve the matching suggestion so multiple drafts cannot collectively exceed it |
| Note | A payment may include optional free text for context or references to receipts, attachments, external transaction IDs, or financial-account identifiers |
| History | All valid payments remain visible with status, sender, recipient, amount, payment date, note, recorder, recorded timestamp, and confirmation audit when applicable |
| External money movement | BranchBalance records a transfer only; it never sends money or connects to a financial account |
| Storage | One SHA-protected `settlements.json` ledger per group serializes concurrent payment writes |

### 17.4 Record a settlement payment

Each non-zero suggested settlement on the Balances screen exposes a **Record payment** action. Opening it creates a draft with:

- Sender and recipient copied from the suggestion and displayed read-only
- Amount prefilled with the suggestion's complete unreserved amount
- Payment date defaulted from the device's local calendar date
- Optional note for payment context or references

The member may reduce the amount to record a partial payment. The amount uses the group's currency and the existing minor-unit parser. It must be positive, fit within `Number.MAX_SAFE_INTEGER`, and be no greater than the latest suggested amount after pending reservations for the same normalized sender and recipient are subtracted.

The payment date must be a real `YYYY-MM-DD` calendar date and cannot be later than the device-local date at submission. A non-empty note is trimmed, may contain line breaks, and is limited to 2,000 Unicode characters. The review confirmation names the sender, recipient, formatted amount, payment date, and whether a note will be shared. Submission is disabled while the request is in flight.

The note may contain plain-text details or references for a receipt or attachment, an external transaction ID, or a financial-account identifier. CR-002 does not upload binary files or add structured financial-account fields. Before saving a non-empty note, the UI warns that every repository member can read it and Git history may retain prior content after deletion. It must advise members not to enter passwords, PINs, CVVs, access tokens, recovery codes, or other authentication secrets. Note text renders as plain selectable text; URLs are not opened automatically.

The authenticated GitHub login supplies `recorded_by`; the injected UTC clock supplies `recorded_at`; and the ID generator supplies one lowercase UUID v4. New records always use `status: pending` with no confirmation audit values. Form state cannot override status or audit values.

After GitHub confirms the write, BranchBalance publishes the pending record without changing net balances. The matching amount becomes reserved, so the UI distinguishes the total amount still owed, the amount awaiting recipient confirmation, and any amount still available to record.

#### 17.4.1 Pending and recipient confirmation

The named recipient sees **Confirm received** on each pending payment whose normalized `to` login matches the authenticated account. No other member may confirm it, including the sender, recorder, or repository owner. The recipient must remain an accepted collaborator with write access.

Confirmation shows the sender, amount, payment date, recorder, and complete optional note, then requires the recipient to affirm that the money was received outside BranchBalance. A successful confirmation changes the record to `confirmed`, sets `confirmed_by` from the authenticated recipient and `confirmed_at` from the injected UTC clock, and immediately recalculates balances and suggestions.

Pending payments do not expire automatically. Any accepted member with write access may delete a pending payment after a deletion-confirmation dialog; the recipient may use the same action to reject an unreceived or incorrect payment. Deletion is the only rejection/cancellation representation in CR-002, with Git history retaining the audit trail.

Confirmation does not reapply the original suggestion cap. The cap was enforced when the pending record was created, and confirmation records the recipient's statement that the transfer actually occurred. If later expenses or other confirmed payments changed the debt in the meantime, the confirmed historical payment still applies and may reverse the resulting balance direction.

A repeated confirmation of an already-confirmed record by the same recipient is idempotent success. If the pending record was deleted, changed, or confirmed with different audit content, refresh and show a stale or conflict state; there is no force-confirm action.

### 17.5 Balance and suggestion behavior

Expense balances are calculated exactly as before. Each valid `confirmed` payment is then applied as a transfer from the debtor to the creditor; `pending` payments do not enter this calculation:

```text
balance[payment.from] += payment.amount_minor
balance[payment.to] -= payment.amount_minor
settlement_sent[payment.from] += payment.amount_minor
settlement_received[payment.to] += payment.amount_minor
```

After every confirmed payment is applied, run the existing deterministic settlement simplification over the adjusted net balances. Separately sum pending amounts by normalized sender-recipient pair. For a matching suggestion:

```text
available_to_record = max(suggested_amount - pending_amount, 0)
```

Pending reservations do not change the displayed net debt. They appear alongside it as **Awaiting confirmation**, and Record payment is disabled when `available_to_record` is zero.

The following invariants apply:

- A pending or confirmed payment never changes `totalSpentMinor`, expense-paid totals, expense-share totals, spending summaries, category totals, payment-method totals, or budget progress.
- Applying valid confirmed payments preserves the zero-sum balance invariant.
- Historical logins referenced by a valid payment remain visible in balance and history data even if they are no longer accepted collaborators.
- A new pending record is allowed only for a sender-recipient pair in the latest suggestion set and cannot exceed that suggestion after existing pending reservations are subtracted.
- A later expense add, edit, or delete does not erase or invalidate a historical payment. It may change or reverse who owes whom, and the next deterministic suggestions reflect the new combined state.
- Deleted and invalid ledger entries do not affect balances.

Member rows continue to show expense-paid and expense-share totals and additionally expose confirmed settlement sent and settlement received totals. Pending amounts are labelled separately and never enter those totals. Labels must keep these concepts distinct so a pending claim or confirmed transfer is never presented as group spending.

### 17.6 Settlement history and correction

The Balances screen includes a **Payment history** section below current suggestions. It is sorted by `paid_on` descending, then `recorded_at` descending, then `id` ascending. Every row shows:

- Pending or Confirmed status
- Sender and recipient
- Amount and group currency
- Payment date
- Optional note in full, with an explicit shared-sensitive-data label when present
- The GitHub login that recorded it
- Recorded timestamp
- Confirming recipient and confirmation timestamp for a confirmed payment

Pending payments are also grouped in an **Awaiting confirmation** section. A recipient-facing item exposes Confirm received; other members see who must confirm it. An empty ledger shows an explicit no-payments state without hiding current suggestions.

Any accepted member with write access may delete a payment after a confirmation that names its status, sender, recipient, amount, and date. Deleting a pending payment releases its reservation without changing net balances. Deleting a confirmed payment immediately recomputes balances and suggestions. Both leave Git history as the repository audit trail. There is no edit action and no in-app restore action in CR-002.

If the payment is already absent after an ambiguous or concurrent delete, treat the requested deletion as successful after confirming the latest ledger from GitHub.

### 17.7 Persistence changes

The group repository gains one optional root-level ledger:

```text
branch-balance-<group-slug>/
├── group.json
├── settlements.json
└── expenses/
    └── <uuid>.json
```

A group without `settlements.json` has no recorded payments and remains fully valid. The file is created when the first payment is recorded and uses this shape:

```json
{
  "schema_version": 1,
  "payments": [
    {
      "id": "8f6cdb85-4677-44af-8d16-e6f70ea54b8a",
      "from": "monalisa",
      "to": "octocat",
      "amount_minor": 2350,
      "currency": "EUR",
      "paid_on": "2026-07-19",
      "note": "Bank transfer. Receipt reference: trip-folder/receipt-42. External transaction ID: TX-48391.",
      "status": "pending",
      "recorded_by": "monalisa",
      "recorded_at": "2026-07-19T15:24:00Z",
      "confirmed_by": null,
      "confirmed_at": null
    }
  ]
}
```

Ledger rules:

- `schema_version` equals `1` and `payments` is an array.
- Each `id` is a unique lowercase UUID v4 within the ledger.
- `from`, `to`, and `recorded_by` are non-empty GitHub logins; sender and recipient differ after case-insensitive normalization.
- `amount_minor` is a positive safe integer.
- `currency` equals the group's currency.
- `paid_on` is a valid calendar date and `recorded_at` is a valid UTC ISO 8601 instant.
- `note` is optional. When present it is trimmed, non-empty, at most 2,000 Unicode characters, and stored as plain text without automatic URL or markup interpretation.
- `status` is exactly `pending` or `confirmed`.
- A pending payment has `confirmed_by: null` and `confirmed_at: null`.
- A confirmed payment has `confirmed_by` equal to `to` after case-insensitive normalization and a valid UTC `confirmed_at` instant that is not earlier than `recorded_at`.
- New writers reject a future `paid_on`; readers do not make persisted validity depend on the device's current date.
- Array order is not meaningful. Presentation and balance derivation use the deterministic ordering defined in this change request.
- Unknown fields are ignored by calculations and preserved by writers for forward compatibility.
- Invalid individual entries are excluded from balances and history and produce safe warnings identifying their array position or ID. One bad entry does not hide other valid payments.
- A malformed top-level ledger produces a data warning, contributes no payments, and blocks ledger mutation until the file is repaired or removed outside the app.

### 17.8 Synchronization and concurrency

`settlements.json` is one ledger rather than one file per payment so concurrent clients cannot create overlapping pending reservations or confirm the same payment without a shared optimistic-concurrency boundary.

A payment submission follows this sequence:

1. Refresh or read the latest expense set and settlement ledger.
2. Apply confirmed payments, recalculate current suggestions, and sum pending reservations by pair.
3. Verify that the selected normalized sender-recipient pair still exists and that the requested amount does not exceed its unreserved remainder.
4. Append the intended pending record, including its optional note, while preserving unknown fields and include the ledger's current blob SHA in the Contents API write.
5. If the ledger does not exist, create it without a SHA.
6. On a stale-SHA or concurrent-create response, fetch the latest ledger, rederive suggestions, and retry only if the requested payment is still valid.

If the pair disappeared or its unreserved amount fell below the draft, reject the write with a stale-settlement state, preserve the entered date, amount, and note, show the refreshed maximum, and let the member adjust or cancel. There is no force-write action.

A concurrent expense mutation may change balances after a pending payment was validated. If the recipient later confirms it, the payment becomes a historical fact and the next refresh derives the resulting balance direction as described in section 17.5.

For a timeout or otherwise ambiguous append, read the ledger. An entry with the intended UUID and exact semantic content confirms success. An unchanged ledger is safe to retry. The same UUID with different content is a data conflict.

Recipient confirmation uses the same ledger SHA and updates only the targeted payment's status and confirmation audit fields. Before writing, refresh the ledger, require the authenticated normalized login to match `to`, and require the record to remain pending. A stale SHA reloads and retries when the same record is still pending. The exact already-confirmed state is idempotent success only when `confirmed_by` matches the recipient; deletion or different confirmation content returns a stale or conflict state. Confirmation never changes the payment note.

Deletes use the same ledger SHA. On conflict, fetch the latest ledger and retry removal if the ID still exists; absence is success. Generic retries must never append a second payment with a new UUID.

Refresh, foreground, focus, and pull-to-refresh continue to use one coalesced group refresh. Expenses, pending reservations, confirmed payments, balances, suggestions, history, warnings, and spending summaries publish as one snapshot so tabs cannot display mixed generations.

### 17.9 Balances experience

The existing Balances tab remains the owner of member totals, adjusted net balances, current suggestions, and payment history.

- Suggested-settlement cards show sender, recipient, amount still owed, amount awaiting confirmation, amount available to record, and **Record payment** when availability is positive.
- The record form distinguishes full and partial payments, accepts the optional shared note, and never implies that BranchBalance will transfer money.
- A stale suggestion preserves the member's amount, date, and note and shows the new available maximum.
- Pending items show **Confirm received** only to the recipient and identify that recipient to everyone else.
- After a successful create, confirmation, or deletion, an accessible status announces the new state and any adjusted remaining balance.
- **Awaiting confirmation** replaces **All settled** when the entire current debt is reserved by pending payments. **All settled** requires no adjusted debt and no pending reservations; payment history remains available.
- Warnings and money meaning use text and do not rely on colour alone.

Overview may continue to show a compact quick-settlement card derived from the adjusted balances. Spending screens remain unchanged because settlement payments are not expenses.

### 17.10 User stories

#### US-CR002-01 — Record a full payment

As a group member, I want to record the full suggested transfer so that the recipient can confirm it was received.

#### US-CR002-02 — Record a partial payment

As a group member, I want to record less than the suggested amount so that the pending amount is reserved and the unreserved debt stays visible.

#### US-CR002-03 — Confirm receipt

As the named recipient, I want to confirm that a pending payment was received so that it affects the group's balances only after my acknowledgement.

#### US-CR002-04 — Add payment context

As a group member, I want to add an optional shared note containing payment context or references such as a receipt, attachment, external transaction ID, or account identifier so that the recipient can identify the transfer.

#### US-CR002-05 — Review payment history

As a group member, I want to see pending and confirmed status, who paid whom, how much, when, the optional note, and both audit identities so that the shared balance is explainable.

#### US-CR002-06 — Correct a mistaken payment

As a group member, I want to delete an incorrect pending or confirmed payment so that reservations or balances can be recalculated from accurate history.

#### US-CR002-07 — Avoid duplicate or excessive payment

As a group member, I want the app to recheck pending reservations when another device changes the ledger so that we do not accidentally record more than the unreserved debt.

#### US-CR002-08 — Continue using an existing group

As a member of a group created before CR-002, I want it to load normally with no payment history until someone records the first settlement.

### 17.11 Acceptance criteria

- [x] CR-001 and CR-002 are explicitly identified as implemented.
- [x] Every current suggested settlement exposes a Record payment action to accepted write-enabled members.
- [x] The form fixes sender and recipient, prefills the full unreserved suggestion, permits a smaller positive amount, and accepts an optional note up to 2,000 characters.
- [x] Zero, negative, unsafe, malformed, future-dated, and above-unreserved-availability submissions are rejected.
- [x] Every new payment is pending, reserves its amount, and leaves net balances unchanged.
- [x] Only the current accepted recipient can confirm receipt; sender, recorder, owner, and unrelated members cannot confirm it.
- [x] Recipient confirmation records confirmation audit fields and immediately applies the payment.
- [x] A confirmed full payment removes or reshapes the affected suggestion and a confirmed partial payment leaves the correct adjusted remainder.
- [x] Confirmed payments update net balances, settlement-sent/received totals, and future suggestions without changing any expense or spending total.
- [x] Pending reservations prevent concurrent drafts from collectively exceeding the current suggestion.
- [x] Missing `settlements.json` loads as an empty history and the first payment creates it.
- [x] Valid historical payments remain effective after later expense changes.
- [x] Payment history uses deterministic ordering and shows status, sender, recipient, amount, payment date, optional note, recording audit, and confirmation audit when applicable.
- [x] Any accepted member with write access can delete a pending or confirmed payment; reservations or balances update immediately as appropriate.
- [x] Concurrent payment appends cannot both consume the same stale suggested amount.
- [x] A stale payment draft preserves amount, date, and note and shows the refreshed maximum without a force-write option.
- [x] Concurrent and ambiguous confirmation is idempotent for the recipient and never confirms a deleted or changed record.
- [x] Ambiguous writes do not create duplicate payment records.
- [x] Invalid ledger entries are warned about and excluded without hiding other valid entries.
- [x] Existing groups, expenses, spending plans, caches, and balance behavior remain compatible when no ledger exists.
- [x] Notes can contain plain-text receipt/attachment references, external transaction IDs, or financial-account identifiers and are visibly identified as shared repository data.
- [x] Notes never enter logs, analytics, commit messages, user-visible errors, or persistent local snapshot caches.
- [x] The UI warns against authentication secrets and CR-002 never initiates money movement or connects to a financial account.
- [ ] Two Android sessions reading the same repository derive identical payment history, balances, and suggestions after refresh.

### 17.12 Test requirements

Unit coverage must include:

- Ledger and payment schema validation, pending/confirmed cross-field rules, duplicate IDs, normalized logins, safe integers, currency matching, note length, and invalid-entry isolation
- Applying only confirmed payments while pending payments reserve suggestion capacity and preserve expense and spending totals
- Deterministic balance, reservation, suggestion, and history ordering
- Historical-member seeding and zero-sum integrity
- Unreserved-amount validation, recipient-only confirmation, idempotent confirmation, and a later expense edit that reverses the debt direction
- Payment-date parsing and writer rejection of future dates

Integration coverage with mocked GitHub responses must include:

- Refresh with a missing, empty, valid, partially invalid, and malformed ledger
- First-file creation as pending and immediate reservation reconciliation without a balance change
- Full and partial pending append writes with notes, SHA replacement, and passthrough preservation
- Recipient confirmation, unauthorized confirmation, SHA retry, idempotent recovery, and confirmation conflicts
- Concurrent append retry when the pending reservation remains valid and stale rejection when it does not
- Ambiguous append recovery by stable UUID without duplication
- Successful, concurrent, ambiguous, and already-absent deletion for pending and confirmed records
- Expense and payment mutations racing while the final snapshot remains internally consistent
- Legacy cache hydration, note redaction from persistent cache, and refresh of an existing remote ledger

Component and navigation coverage must include current suggestions, pending reservations, the full/partial form, read-only sender and recipient, sensitive-note warning, plain-text note rendering, recipient-only confirmation, accessible status, stale-draft recovery, history ordering, delete confirmation, empty history, Awaiting confirmation, All settled with retained history, and safe warnings.

The manual two-account Android test must record a partial pending payment with a note on one device, verify that balances remain unchanged and the amount is reserved on the other, confirm receipt as the recipient, and observe the adjusted suggestion on both. It must then record and confirm the remainder, delete one payment, verify identical balances and history, and race two submissions against one suggestion so the stale device cannot over-reserve or create a duplicate.

### 17.13 Explicitly deferred from CR-002

- Initiating bank, card, wallet, cash, or payment-provider transfers
- Arbitrary transfers that are not based on a current suggestion
- Overpayments that intentionally reverse a current debt
- Editing payment records in place
- Binary receipt or attachment uploads; CR-002 stores only plain-text details or references in `note`
- Structured external-transaction or financial-account fields separate from the optional note
- Per-expense settlement allocation
- Recurring or scheduled payments
- Push notifications or payment reminders
- Offline settlement writes and offline conflict resolution

These require separate product and security requirements before implementation.

## 18. Technical references

- [Generating a user access token for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [Refreshing GitHub App user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens)
- [GitHub App installation endpoints](https://docs.github.com/en/rest/apps/installations)
- [Repository endpoints](https://docs.github.com/en/rest/repos/repos)
- [Repository collaborator endpoints](https://docs.github.com/en/rest/collaborators/collaborators)
