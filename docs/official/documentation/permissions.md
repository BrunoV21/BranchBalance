---
title: Membership and permissions
description: How repository ownership, accepted collaborators, and pending invitations define a BranchBalance group.
---

# Membership and permissions

GitHub is the source of truth for who belongs to a BranchBalance group. The app does not persist a duplicate member list in `group.json`.

## Repository owner

The person who creates the group owns its private repository and is always a group member. The owner manages collaborator invitations because that operation requires repository administration permission.

## Accepted members

Accepted collaborators with write access are group members. They can read the shared data; add, edit, or delete expenses; update the shared spending plan; and record or delete settlement payments based on current suggestions. A new settlement payment remains pending until the named recipient confirms receipt. No other member—including the sender, recorder, or repository owner—can confirm on that recipient's behalf.

## Pending invitations

Pending invitees are displayed separately and do not participate in expenses or balances until they accept through GitHub. Invited collaborators authorize BranchBalance, but do not need to install the GitHub App on their own account to access a repository covered by the owner’s installation.

## Historical usernames

If a username referenced by a historical expense or valid settlement payment is no longer an active collaborator, it remains in the balance calculation so the stored record does not silently change meaning. A former member cannot confirm a pending payment because confirmation requires the current accepted recipient with write access.

For the complete requirements, see the [product requirements](../reference/PRD#5-users-membership-and-permissions).
