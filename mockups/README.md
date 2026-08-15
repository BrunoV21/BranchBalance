# BranchBalance HTML mockups

Open `index.html` in a browser to view all screens. Each screen is also a standalone HTML file and shares `styles.css` and `script.js`.

The responsive product website and documentation prototype starts at `website/index.html`. It includes a product landing page, searchable documentation hub, data-ownership article, and truthful `v1.0.0 Preview` releases page. The website shares its own `website/styles.css` and `website/script.js` while reusing the current brand assets and mobile mockups.

## Included screens

1. Sign in
2. GitHub device authorization
3. Typed group list with explicit Trip/Fuel icons, purpose labels, and CR-003 invitation actions
4. Create group with immutable Trip/Fuel selection (Trip default) and a CR-008 link to request another type through a dedicated public GitHub Issue Form
5. Trip Overview with compact date, budget, and pace preview
6. Add Trip expense
7. Edit/delete Trip expense
8. Shared Members and invitations surface, with selected-group type context
9. Shared Balances, simplified debts, and per-member Paid-versus-Share funding analytics
10. Trip Spending dashboard with even-budget pace, deterministic insights, category/scope mix, payment-method breakdowns, and combinable expense filters
11. Trip plan settings with required inclusive dates, optional total budget, and optional category limits
12. CR-004 recent activity inbox with unread treatment, foreground-refresh context, per-item dismissal, clear-all confirmation, and empty state
13. CR-006 private on-device Generic receipt capture with a clear route to the five-value editable preview
14. CR-006 editable Generic OCR preview grouping merchant, amount, date, and optional line items before manual expense choices
15. Fuel Overview with current-month limit progress, fill-ups, litres, weighted paid price, discounts, and completeness
16. Fuel Spending with month navigation, spend-versus-limit, volume, unit-price, savings, stations, and coverage views
17. Fuel monthly-limit plan with effective-month history and no rollover
18. Fuel receipt capture with explicit dedicated-profile status and a clear route to the seven-field editable preview
19. Editable Fuel OCR preview grouping paid amount, litres, printed unit price, gross total, discount, date, and station before manual expense choices

CR-001 is also represented in the updated group overview and add/edit expense flows. The expense form includes the fixed category taxonomy, Card/Cash/Other payment methods, and the Just me split shortcut. Legacy expenses remain visible as Uncategorized and Unspecified states in the Spending screen.

CR-003 is represented on the Group list: **Invited groups** appears directly below **Create a group**, and its pending GitHub repository card exposes Accept and Decline actions. The Members screen also explains that invitees can make the decision from BranchBalance.

CR-004 is represented by the inbox-style icon and unread dot in the **Your groups** header plus the standalone Recent activity screen. The inbox presents safe cross-group action summaries, distinguishes newly observed items without relying on colour, links to the relevant group area, and demonstrates individual dismissal and local clear-all behavior. Its copy explicitly describes foreground discovery rather than push or real-time delivery.

CR-005 is represented across Overview, Spending, and Balances. Overview gives a compact non-interactive pace preview; Spending compares cumulative tracked spending with a clearly labelled even-budget reference, summarizes three deterministic insights, and links category and Shared/Just me analytics to the expense filters; Balances compares Paid and Share on one scale while keeping the expense funding gap distinct from settlement-adjusted net balances. Every graphical conclusion is repeated in accessible text, and no chart is described as a forecast.

CR-006 is represented as a proposed flow, not a shipped feature. Overview keeps one **Add expense** control and adds receipt scanning as its compact camera segment, separated by a divider and exposed to assistive technology as **Scan receipt**. The capture screen states that recognition stays on the device, previews the exact extraction scope, and offers camera, photo-library, and manual alternatives. Its result reuses the Add expense form but first groups every detected value in an **Editable OCR preview**: Description, Amount, Date, and any editable/removable line items with a live total check. Category and Payment method remain unselected below the preview, and explicit review and save are still required. Confirmed rows become shared expense metadata; receipt pixels and raw OCR remain local and temporary.

CR-007 is represented end to end. Existing and newly created Trip groups share the current expense workflow, generic OCR profile with optional line items, required plan dates, optional budgets, and trip pace analytics. Fuel groups use the same navigation, membership, sharing, balances, and settlements, while substituting a calendar-month limit plan, dedicated Fuel receipt profile, optional typed fuel details, and Fuel-specific analytics; the Fuel profile does not populate the generic line-item list. Both scan routes lead directly to a type-specific editable preview containing all extracted fields before manual category/payment/payer/split decisions, and Fuel arithmetic feedback updates as extracted values are edited. Every chart has a textual conclusion and table or ordered-data equivalent; incomplete Fuel data is disclosed and never extrapolated. Open `08-members.html?group=fuel` or `09-balances.html?group=fuel` to see the shared screens in Fuel context.

CR-008 is represented on Create group as a clearly separate **Request another group type** action below Trip and Fuel. It opens the repository's dedicated `group_type_request.yml` public GitHub Issue Form in a new tab, does not change the selected supported type, and warns requesters about the public destination before they leave the mockup.

Use the moon/sun button to switch between light and dark modes. The choice is stored in browser `localStorage`.
