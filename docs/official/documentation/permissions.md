---
title: Owners, members, and invitations
description: Who controls a group, who can see its expenses, and how invitations work.
---

# Owners, members, and invitations

The group creator chooses who can join. Only the creator and people who accept an invitation can see and change the shared group information.

## Group creator

The person who creates the group controls its private space and is always a member. They are the only person who can send group invitations.

## Group members

After accepting an invitation, a member can see the shared data; add, edit, or delete expenses; update the spending plan; and record settlement payments. A new payment stays pending until the person receiving the money confirms it arrived. Nobody else can confirm on their behalf.

## Pending invitations

People with a pending invitation are shown separately and do not participate in expenses or balances until they accept. They can accept or decline from **Your groups** in BranchBalance.

BranchBalance uses GitHub’s private-repository access list behind the scenes. Invited members authorize BranchBalance with their GitHub account, but they do not need to set up a GitHub App themselves.

## Historical usernames

If a username referenced by a historical expense or valid settlement payment is no longer an active collaborator, it remains in the balance calculation so the stored record does not silently change meaning. A former member cannot confirm a pending payment because confirmation requires the current accepted recipient with write access.

For the complete requirements, see the [product requirements](../reference/PRD#5-users-membership-and-permissions).
