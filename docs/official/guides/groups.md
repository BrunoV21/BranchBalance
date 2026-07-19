---
title: Create and invite a group
description: Create a private repository-backed group and invite GitHub collaborators.
---

# Create and invite a group

## Create the group

Choose a required name and one supported currency: EUR, USD, or GBP. BranchBalance creates a private repository named `branch-balance-<slug>` and writes `group.json` to its actual default branch.

If repository creation succeeds but the group file cannot be written, BranchBalance reports a partial creation and offers a safe retry. Discovery ignores the repository until it contains a valid group file.

## Invite members

The repository owner enters a GitHub username from the Members tab. GitHub sends the private-repository invitation; the app displays it as pending until the user accepts or declines it.

The invitee sees eligible BranchBalance invitations below **Create a group** on **Your groups**. They can review the repository, inviter, requested access, and invitation date, then accept or decline without leaving BranchBalance. Acceptance keeps the user on **Your groups** while the app validates the repository and adds a valid group to **Active groups**.

The form rejects the owner, an accepted collaborator, and an already-pending username. GitHub remains authoritative for both accepted and pending membership.

Read [membership and permissions](../documentation/permissions) for the exact access model.
