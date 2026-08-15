---
title: Where BranchBalance stores your data
description: A plain-language explanation of what is shared, what stays on your phone, and who can see it.
outline: deep
---

# Where BranchBalance stores your data

Your shared expenses live in a private group space controlled by the creator. Here is the plain-language overview, followed by the technical details for anyone who wants them.

::: tip The short version
Only accepted group members can see the shared expenses. BranchBalance does not keep a separate copy of that history on its own data server.
:::

## One group, one private space

When you create a group, BranchBalance creates a private repository named `branch-balance-<group-name>` under your personal GitHub account. The repository owner controls it and invites the other group members as collaborators.

<div class="ownership-diagram" role="img" aria-label="The Android app exchanges data directly with a private GitHub repository using the GitHub API.">
  <div class="arch-node">
    <div class="point-icon">▯</div>
    <strong>Android app</strong>
    <small>Displays, validates, and calculates on-device.</small>
  </div>
  <div class="arch-arrow"><span>GitHub API →</span></div>
  <div class="arch-node">
    <div class="point-icon">⑂</div>
    <strong>Private repository</strong>
    <small>Stores the shared source-of-truth files and history.</small>
  </div>
</div>

GitHub supplies identity, repository access, membership, storage, and file history. BranchBalance supplies the expense-sharing experience and business rules. There is no BranchBalance database or server between the two.

## What lives in the repository

The repository uses a deliberately small, readable layout. Group settings live in one file, recorded settlement payments share one concurrency-protected ledger, and each active expense lives in its own JSON document.

```text
branch-balance-road-trip/
├── group.json
├── settlements.json
└── expenses/
    ├── 6f2c1a3e-2b1d-4a3a.json
    └── 72ab4e25-f901-4b3c.json
```

`group.json` contains the group name, currency, creator, creation time, and optional spending plan. Expense files contain the amount, date, payer, deterministic shares, category, payment method, and audit fields. The optional `settlements.json` records pending and recipient-confirmed payments made outside BranchBalance, including an optional shared plain-text note.

```json
{
  "schema_version": 1,
  "description": "Dinner at Nando's",
  "amount_minor": 8400,
  "currency": "EUR",
  "paid_by": "alexk",
  "category": "food_drink",
  "payment_method": "card",
  "participants": ["alexk", "mayab"]
}
```

Amounts are stored as integer minor units—cents for EUR—so persisted money never depends on binary floating-point calculations. The full schema also stores exact per-person shares and timestamps.

## What stays on your device

Your GitHub access token, refresh token, and their expiries stay together in Android secure storage. BranchBalance rotates them atomically and clears the session when refresh access is no longer valid.

The app may also cache non-secret account and group snapshots locally. Those snapshots help keep the latest successful data visible during refreshes or temporary network failures, but they are never authoritative. GitHub remains the source of truth.

Settlement notes may contain receipt or attachment references, external transaction IDs, or financial-account identifiers. They stay in the private repository and the current in-memory view; BranchBalance deliberately removes note text and lossless ledger source data from persistent device snapshots. Do not put passwords, PINs, CVVs, access tokens, recovery codes, or other authentication secrets in a note. Git history may retain prior note content after deletion.

<table class="responsive-fact-table">
  <thead>
    <tr><th>Information</th><th>Stored in</th><th>Purpose</th></tr>
  </thead>
  <tbody>
    <tr><td data-label="Information">Group, expenses, and settlement ledger</td><td data-label="Stored in">Private GitHub repository</td><td data-label="Purpose">Shared source of truth for accepted members</td></tr>
    <tr><td data-label="Information">Access and refresh tokens</td><td data-label="Stored in">Secure storage on the device</td><td data-label="Purpose">Authenticate direct GitHub API requests</td></tr>
    <tr><td data-label="Information">Cached snapshots</td><td data-label="Stored in">Local app storage</td><td data-label="Purpose">Show the latest successful non-secret data while refreshing</td></tr>
    <tr><td data-label="Information">Group membership</td><td data-label="Stored in">GitHub collaborator list</td><td data-label="Purpose">Determine accepted and pending members without duplicating the list</td></tr>
  </tbody>
</table>

## Who can see group data

The repository owner and accepted GitHub collaborators with access to the private repository can see the shared group data. Pending invitees do not count as members until they accept. BranchBalance reads GitHub’s live collaborator list rather than maintaining a separate membership database.

All spending-plan, expense, and settlement metadata is shared with those group members. A **Just me** expense creates no debt, but it is still visible to the group and counts toward group spending. A settlement note is not private from other repository members and is not end-to-end encrypted by BranchBalance.

## Portable and auditable

Because the source data is ordinary JSON in Git, it can be inspected with GitHub, downloaded with the repository, or processed with your own tools. Git history provides an audit trail even though the Phase 1 app does not include a restore interface.

Edits and deletes use the latest GitHub blob identifier as a precondition. If someone changed an expense or settlement ledger from another device, BranchBalance fetches the newest copy and revalidates the operation instead of silently overwriting their work.

## What the ownership promise does—and does not—mean

::: warning Private does not mean end-to-end encrypted by BranchBalance
Your repository is protected by GitHub’s private-repository access controls. BranchBalance does not add its own encryption layer or make claims about GitHub’s service beyond that.
:::

- Phase 1 is always online; the repository is not cloned for offline editing.
- The app depends on GitHub for authentication, storage, availability, and access control.
- The repository creator owns the repository; other members participate as collaborators.
- Deleting an expense or settlement payment removes it from the app, but its change remains part of Git history.

That boundary is intentional: BranchBalance’s promise is a transparent and inspectable data model, not a claim that infrastructure disappears.
