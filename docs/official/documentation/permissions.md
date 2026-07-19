---
title: Membership and permissions
description: How repository ownership, accepted collaborators, and pending invitations define a BranchBalance group.
---

# Membership and permissions

GitHub is the source of truth for who belongs to a BranchBalance group. The app does not persist a duplicate member list in `group.json`.

## Repository owner

The person who creates the group owns its private repository and is always a group member. The owner manages collaborator invitations because that operation requires repository administration permission.

## Accepted members

Accepted collaborators with write access are group members. They can read the shared data and add, edit, or delete expenses. They can also update the shared spending plan.

## Pending invitations

Pending invitees are displayed separately and do not participate in expenses or balances until they accept through GitHub. Invited collaborators authorize BranchBalance, but do not need to install the GitHub App on their own account to access a repository covered by the owner’s installation.

## Historical usernames

If a username referenced by a historical expense is no longer an active collaborator, it remains in the balance calculation so the stored record does not silently change meaning.

For the complete requirements, see the [product requirements](../reference/PRD#5-users-membership-and-permissions).
