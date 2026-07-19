---
title: Add and split expenses
description: Record shared or personal expenses with exact deterministic shares.
---

# Add and split expenses

Every expense has a description, positive amount, calendar date, payer, category, payment method, and split.

## Equal split

Choose one or more accepted members. BranchBalance converts the amount to integer minor units and distributes any remainder deterministically by username so every device produces the same shares.

## Full-to-one

Choose exactly one member other than the payer. That person owes the complete amount.

## Just me

Just me is an equal split whose only participant is the payer. It creates no debt, but remains visible to the group and counts toward spending totals and budgets.

## Editing and deleting

Any accepted member with write access may edit or delete an expense. Both operations use the latest GitHub blob identifier; a concurrent change opens a review flow instead of being silently overwritten.
