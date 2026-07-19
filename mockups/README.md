# BranchBalance HTML mockups

Open `index.html` in a browser to view all screens. Each screen is also a standalone HTML file and shares `styles.css` and `script.js`.

The responsive product website and documentation prototype starts at `website/index.html`. It includes a product landing page, searchable documentation hub, data-ownership article, and truthful `v1.0.0 Preview` releases page. The website shares its own `website/styles.css` and `website/script.js` while reusing the current brand assets and mobile mockups.

## Included screens

1. Sign in
2. GitHub device authorization
3. Group list with CR-003 invitation accept/decline actions
4. Create group
5. Group overview with compact budget-pace preview
6. Add expense
7. Edit/delete expense
8. Members and invitations
9. Balances, simplified debts, and per-member Paid-versus-Share funding analytics
10. Spending dashboard with even-budget pace, deterministic insights, category/scope mix, payment-method breakdowns, and combinable expense filters
11. Spending-plan settings for total budget, an optional budget-period start and end, and independent category limits
12. CR-004 recent activity inbox with unread treatment, foreground-refresh context, per-item dismissal, clear-all confirmation, and empty state

CR-001 is also represented in the updated group overview and add/edit expense flows. The expense form includes the fixed category taxonomy, Card/Cash/Other payment methods, and the Just me split shortcut. Legacy expenses remain visible as Uncategorized and Unspecified states in the Spending screen.

CR-003 is represented on the Group list: **Invited groups** appears directly below **Create a group**, and its pending GitHub repository card exposes Accept and Decline actions. The Members screen also explains that invitees can make the decision from BranchBalance.

CR-004 is represented by the inbox-style icon and unread dot in the **Your groups** header plus the standalone Recent activity screen. The inbox presents safe cross-group action summaries, distinguishes newly observed items without relying on colour, links to the relevant group area, and demonstrates individual dismissal and local clear-all behavior. Its copy explicitly describes foreground discovery rather than push or real-time delivery.

CR-005 is represented across Overview, Spending, and Balances. Overview gives a compact non-interactive pace preview; Spending compares cumulative tracked spending with a clearly labelled even-budget reference, summarizes three deterministic insights, and links category and Shared/Just me analytics to the expense filters; Balances compares Paid and Share on one scale while keeping the expense funding gap distinct from settlement-adjusted net balances. Every graphical conclusion is repeated in accessible text, and no chart is described as a forecast.

Use the moon/sun button to switch between light and dark modes. The choice is stored in browser `localStorage`.
