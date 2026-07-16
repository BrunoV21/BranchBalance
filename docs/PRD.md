# BranchBalance — Phase 1 PRD

> Working name: **BranchBalance** (placeholder — swap `APP_PREFIX` wherever it appears before shipping).
> A peer-distributed, GitHub-backed expense splitter. No backend server. Each group is a private GitHub repo; GitHub itself is the database, the auth provider, and the sharing mechanism.

---

## 1. Overview

BranchBalance lets two or more GitHub users track shared expenses inside a group, split costs, and see who owes whom — with zero backend infrastructure. A "group" is a private GitHub repo. Membership is GitHub repo collaboration. Expenses are JSON files committed to that repo via the GitHub API.

This document scopes **Phase 1 only**: the smallest version that proves the whole loop works end-to-end on a real Android phone.

---

## 2. Phase 1 goal

Ship an installable APK, built and tested on macOS, where:

1. The user signs in with their GitHub account.
2. The user creates a group → this creates a real private GitHub repo.
3. The user invites another GitHub user to the group.
4. That person signs in with their own GitHub account and sees the group.
5. Both members can add expenses and choose how each expense is split.
6. Both members see a live balance: who paid what, and who owes whom.

If those six things work on a physical device, Phase 1 is done.

---

## 3. Scope decisions (read this before building)

The original conversation also designed a fully offline-first sync layer (`isomorphic-git`, real local `.git` clones, conflict-free event files). That architecture is **correct for the long-term vision but is deliberately deferred out of Phase 1** to get a working app fast. Phase 1 talks to GitHub over the REST API only (always-online). The data model below is written so Phase 2 can add offline `isomorphic-git` sync later **without changing the file format** — same repo layout, same JSON schema, just a different sync mechanism underneath.

Other assumptions made below, flagged so they're easy to override — see [Section 10, Open questions](#10-open-questions-for-you).

---

## 4. Non-goals for Phase 1

Explicitly **not** building yet:

- Offline mode / local git clone / `isomorphic-git` sync
- Editing or deleting an existing expense (append-only ledger for now)
- "Settle up" / marking a debt as paid
- Exact-amount or percentage splits (only **Equal** and **Full-to-one**, see [6.5](#65-add-an-expense))
- Multi-currency conversion (one currency per group, no FX)
- Push notifications or background sync (manual pull-to-refresh only)
- Removing members or deleting groups
- iOS build (architecture supports it later; Phase 1 targets Android only)
- Receipt photos / attachments

---

## 5. Users & roles

- Any person with a GitHub account can use the app.
- A group's **repo owner** is whoever created it (their GitHub App installation is what grants the app API access to that repo — see [7.2](#72-auth-flow)).
- All other members are **GitHub collaborators** on that repo. GitHub's own collaborator list *is* the membership list — do not duplicate a "members" array in app data, always read it live from `GET /repos/{owner}/{repo}/collaborators`.
- No in-app roles/permissions beyond what GitHub already provides (owner vs. collaborator).

---

## 6. Core user flows

### 6.1 Sign in with GitHub
- User taps "Sign in with GitHub."
- App starts the GitHub **device flow**: shows a code, opens (or links to) `https://github.com/login/device`.
- On success, app receives a user access token and stores it in `expo-secure-store`.
- App fetches `GET /user` to get and cache the username/avatar.

### 6.2 Create a group
- User enters a group name (e.g. "Road trip 2026") and a currency (default a single hardcoded value, e.g. `USD`, editable).
- App slugifies the name and creates a repo: `POST /user/repos` with name `<APP_PREFIX>-<slug>`, `private: true`.
- App writes an initial `group.json` to the new repo (see [7.4](#74-groupjson-schema)).
- App creates an empty `expenses/.gitkeep` (GitHub's Contents API can't create an empty folder directly — seed it with a placeholder file so the `expenses/` path exists).

### 6.3 Invite a member
- From a group screen, user enters a GitHub username and taps "Invite."
- App calls `PUT /repos/{owner}/{repo}/collaborators/{username}`.
- UI shows "Invite sent — pending" until that username shows up in the collaborators list as accepted (poll on screen focus / pull-to-refresh; GitHub does not push this to the app).

### 6.4 Accept invite & see group
- The invited user gets GitHub's own notification/email and accepts the repo invite (outside the app, via GitHub — Phase 1 does not need an in-app "accept" screen).
- Once accepted, they sign in to BranchBalance (6.1) and the app's group list picks up the repo automatically (see [8.3](#83-discovering-a-users-groups)).

### 6.5 Add an expense
Form fields:
- Description (text)
- Amount (number)
- Paid by (defaults to the current user, but can be any group member — needed for entering an expense someone else already paid)
- Split type — **exactly two options for Phase 1**:
  - **Equal** — pick which members share the cost (defaults to all current members); cost is divided evenly among them.
  - **Full-to-one** — pick exactly one other member; that person owes the entire amount to whoever paid.
- On submit, app writes a new file `expenses/<uuid>.json` via `PUT /repos/{owner}/{repo}/contents/expenses/{uuid}.json` (schema in [7.5](#75-expense-file-schema)).

### 6.6 View balances
- Group screen has a "Balances" section, computed **client-side** from every expense file (see algorithm in [7.6](#76-balance-computation)).
- Shows: total paid by each member, and a simplified settlement list ("Bob owes Alice $23.50").
- Pull-to-refresh re-fetches all expense files and recomputes.

---

## 7. Data model & GitHub integration

### 7.1 Repo naming

```
<APP_PREFIX>-<group-slug>
```
e.g. `branch-balance-road-trip-2026`. `APP_PREFIX` is a constant in the app config — pick something unlikely to collide with the user's other repos.

### 7.2 Auth flow

- Register a **GitHub App** (not a classic OAuth App).
- Repository permissions needed: **Administration** (create/delete repos, manage collaborators), **Contents** (read/write files).
- Enable **Device Flow** in the app's settings (off by default as of 2025).
- Use `@octokit/auth-oauth-device` with `clientType: "github-app"`.
- Token expiry: default is 8-hour expiring tokens + a refresh token — but refreshing needs a client secret you don't have as a pure client app. For Phase 1, simplest path: **turn off "Expire user authorization tokens"** in the app's Optional Features so tokens don't expire. (Trade-off noted in [10](#10-open-questions-for-you) — flip this back on later if you add a tiny refresh proxy.)
- Whoever **owns** a repo must have installed the GitHub App on their account for the app to have API access to it — this happens automatically the first time they sign in and authorize the app. Repos the app *creates* are auto-added to that installation's access, no extra step needed. Collaborators just need their own one-time sign-in; they do not need to separately "install" anything.

### 7.3 Discovering a user's groups

- Primary: `GET /user/installations/{installation_id}/repositories` (repos the app can see for this user) filtered client-side by name prefix `<APP_PREFIX>-`.
- This covers both repos the user owns and repos they're a collaborator on, as long as the owner has an active installation covering that repo.
- Cache the result locally; only re-fetch on pull-to-refresh or app foreground, not on every screen visit — avoid hammering rate limits.

### 7.4 `group.json` schema

Stored at the repo root.

```json
{
  "name": "Road trip 2026",
  "currency": "USD",
  "created_by": "octocat",
  "created_at": "2026-07-16T12:00:00Z"
}
```

### 7.5 Expense file schema

One file per expense, stored at `expenses/<uuid>.json`. Never overwritten, never reused — this is what keeps concurrent writes from different devices conflict-free later in Phase 2.

```json
{
  "id": "6f2c1a3e-2b1d-4a3a-9c3e-9d2f9a0b1234",
  "description": "Dinner at Nando's",
  "amount": 42.50,
  "currency": "USD",
  "paid_by": "octocat",
  "split_type": "equal",
  "participants": ["octocat", "monalisa"],
  "created_by": "octocat",
  "created_at": "2026-07-16T18:32:00Z"
}
```

Notes:
- `participants` is the list of people who **owe a share** of this expense. For `equal`, list everyone sharing the cost (the payer can be included or left out — if included, their own share simply nets against what they paid). For `full`, this list has exactly one entry: the person who owes the whole amount.
- `amount` is always positive, in the group's currency (no per-expense currency conversion in Phase 1).

### 7.6 Balance computation

Runs entirely client-side over every expense file in a group. Pseudocode:

```
balance = {}  # username -> running total, starts at 0 for every member

for each expense in group:
    share = expense.amount / len(expense.participants)
    balance[expense.paid_by] += expense.amount
    for person in expense.participants:
        balance[person] -= share

# balance[x] > 0  → x is owed money overall
# balance[x] < 0  → x owes money overall
```

To turn net balances into a short "who pays whom" list, run a standard debt-simplification pass:

```
debtors   = sorted people with balance < 0, most negative first
creditors = sorted people with balance > 0, most positive first

while debtors and creditors non-empty:
    d = debtors[0]; c = creditors[0]
    amount = min(-d.balance, c.balance)
    record settlement: d owes c `amount`
    d.balance += amount; c.balance -= amount
    drop d or c from their list if balance hits 0
```

This minimizes the number of "X owes Y" lines shown, and works the same whether the group has 2 people or 8.

### 7.7 GitHub API calls this app makes

| Action | Endpoint |
|---|---|
| Sign in | `POST /login/device/code`, `POST /login/oauth/access_token` |
| Get current user | `GET /user` |
| Create group | `POST /user/repos`, then `PUT /repos/{owner}/{repo}/contents/group.json` |
| List my groups | `GET /user/installations/{id}/repositories`, filtered client-side |
| Invite member | `PUT /repos/{owner}/{repo}/collaborators/{username}` |
| List members | `GET /repos/{owner}/{repo}/collaborators` |
| Add expense | `PUT /repos/{owner}/{repo}/contents/expenses/{uuid}.json` |
| Fetch all expenses | `GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1` to list files, then fetch each blob — cheaper than listing the `expenses/` folder file-by-file |

---

## 8. Tech stack

- **React Native + Expo.** Because Phase 1 has no `isomorphic-git` (no native filesystem module needed), you can stay in Expo's standard managed workflow — no `expo prebuild` required yet. This makes local dev on your Mac and testing on your Android phone much simpler (Expo Go or a plain dev client, QR-code load, no Xcode/Android Studio native build loop while iterating).
- **`@octokit/rest`** + **`@octokit/auth-oauth-device`** for all GitHub calls.
- **`expo-secure-store`** for storing the access token on-device.
- **`expo-router`** for navigation (sign-in → group list → group detail → add expense).
- **React Context + hooks** for state — no Redux/Zustand needed at this scale.
- **Build**: `eas build --platform android --local` (or `./gradlew assembleRelease` once you do need to prebuild) to produce a sideloadable APK, no cloud build service required.

---

## 9. Acceptance criteria

- [ ] User can sign in via GitHub device flow on a physical Android device
- [ ] User can create a group, which creates a private repo `<APP_PREFIX>-<slug>` containing `group.json`
- [ ] User can invite a second GitHub account by username; the invite shows up on GitHub's own site as pending
- [ ] After accepting the GitHub invite and signing in, the second user sees the group in their list
- [ ] Either member can add an expense with description, amount, payer, and split type (equal or full-to-one)
- [ ] Each expense is persisted as its own file under `expenses/` in the repo
- [ ] Group screen lists all expenses and shows computed balances (total paid per person + simplified settlement list)
- [ ] Pull-to-refresh re-syncs from GitHub and recomputes balances
- [ ] A signed APK built locally on macOS installs and runs on a physical Android phone

---

## 10. Open questions for you

Things this PRD assumed a default for — confirm or override before/while building:

1. **App prefix / name** — used `branch-balance` as a placeholder throughout. What should it actually be? - branch-balance
2. **Currency** — one currency per group, no conversion, is that fine for Phase 1? - yes use euros as default
3. **No edit/delete of expenses** — append-only for now. Acceptable, or do you need at least delete in Phase 1? - there should be possible to edit / delete expenses
4. **Manual refresh only** — no polling/notifications yet. Acceptable for Phase 1? - wrong we should refresh every time we load the screen / open the app and let the user refresh manually by dragging from the top!
5. **Non-expiring tokens** — simplifies auth but is less secure than GitHub's default. Fine for a personal-scale app, or do you want the 8-hour expiry kept (which means building the client-secret-requiring refresh flow, or a silent re-run of device flow instead)? - refresh flow should be put in place
6. **Repos always private** — confirm that's the intent (vs. letting the user choose public/private per group). - yes repos always private for now

---

## 11. Phase 2 candidates (not now, just parked)

- `isomorphic-git`-based offline sync (real local `.git` clone, works without network, push/pull to reconcile)
- Edit/delete expenses
- Exact-amount and percentage splits
- Settle-up recording
- Multi-currency support
- iOS build
- Push notifications (would require *some* server — worth revisiting the "zero backend" constraint if this becomes a priority)