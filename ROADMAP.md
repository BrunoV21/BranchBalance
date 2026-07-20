# BranchBalance Roadmap

**Last updated:** 2026-07-20

This roadmap tracks unresolved product limitations and future work. It does not expand the implemented Phase 1 scope unless an item is promoted into an approved change request in `docs/PRD.md`.

## Reliable pre-acceptance private invitation discovery

**Priority:** P0

**Status:** Blocked on GitHub App user-token behavior; discovery and architecture decision required

**Related:** CR-003

### Known limitation

The implemented CR-003 flow calls `GET /user/repository_invitations` with the signed-in user's GitHub App user access token. Physical-device testing confirmed a response of `200 OK` with zero rows and `X-Accepted-GitHub-Permissions: administration=read` while that GitHub account had a pending private-repository invitation visible on GitHub.

GitHub App user access tokens can access only resources available to both the user and app. Before accepting a private-repository invitation, the invitee does not yet have repository access. Consequently, GitHub may omit the invitation rather than return a permission error, and BranchBalance cannot distinguish the omission from an account with no invitations.

Current user workaround: accept the repository invitation through GitHub's website, notification, or email, return to BranchBalance, and refresh **Your groups**.

### Resolution work

1. Test the GitHub App account permission **Private repository invitations: read** with a newly approved authorization and record whether it changes the authenticated-user endpoint response. Treat this as a compatibility experiment, not a documented fix.
2. If the response remains empty, write an architecture decision comparing:
   - an OAuth authorization flow using GitHub's targeted `repo:invite` scope;
   - a minimal backend or owner-mediated invitation handoff that does not expose app credentials or create a second membership authority.
3. Define token migration, revocation, SecureStore, privacy, abuse-prevention, and failure-state requirements for the selected approach.
4. Promote the selected design into a new PRD change request before implementation.
5. Repeat the full two-account Android test: display the invitation in BranchBalance, decline it, resend it, accept it, and verify that the repository becomes a validated active group without duplicate decisions.

### Completion criteria

- A pending private `branch-balance-*` repository invitation is discoverable before repository access is accepted.
- The invitee can accept or decline it from **Your groups** on a physical Android device.
- The solution does not broaden access to repository contents unnecessarily or ship a client secret.
- Empty, permission-denied, revoked, expired, and ambiguous responses remain distinguishable and recoverable.
- Automated tests and the two-account physical-device acceptance scenario pass.

### References

- [GitHub repository invitation endpoints](https://docs.github.com/en/rest/collaborators/invitations)
- [GitHub App user access-token resource intersection](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)

## Curated invoice corpus for OCR and VLM quality

**Priority:** P1

**Status:** Privacy, consent, data-governance, and model-evaluation design required

Build a separately governed invoice dataset with reviewed ground-truth annotations, then use it to improve the on-device OCR pipeline and, if the existing local-VLM decision gate passes, fine-tune or evaluate a schema-constrained VLM. This is a future research and quality initiative; the current product must not retain production receipts or learn from member corrections unless a new PRD change request explicitly replaces that privacy contract.

### Proposed direction

1. Define an explicit, revocable opt-in contribution flow. Do not silently collect production invoices, OCR output, or user corrections, and do not make contribution a condition of receipt scanning.
2. Store contributed source invoices and annotations in a dedicated, access-controlled database and object store, isolated from group repositories and operational application data. Define encryption, retention, deletion, audit, regional-processing, and incident-response requirements before collecting data.
3. Define a versioned annotation schema covering the expected expense fields—merchant or description, total amount in minor units, transaction date, and currency—plus relevant text, bounding boxes, locale, document type, reviewer status, ambiguity markers, and redaction metadata. Exclude or irreversibly redact payment credentials and unrelated sensitive identifiers.
4. Establish reviewer guidance and dual-review or adjudication for ambiguous labels. Version every dataset split and annotation revision so each model artifact is reproducible and traceable to approved training data.
5. Keep fixed train, validation, and held-out test partitions separated by source document and contributor. Use the training partition to fine-tune or adapt OCR models and, only after the separate local-VLM approval, candidate VLMs; never tune against the held-out regression partition.
6. Add a dedicated, reproducible quality suite that compares every OCR/model change with the pinned released baseline. Measure character and word error rates, per-field precision/recall or exact match, full-document extraction success, confidence calibration, unsupported-locale behavior, latency, peak memory, and app-size impact across the supported device matrix.
7. Define release-blocking degradation budgets for the overall corpus and critical slices such as locale, currency, image quality, layout, and device tier. CI or the release workflow must fail when a candidate exceeds a budget, loses coverage, changes the test corpus unexpectedly, or cannot reproduce its model and dataset provenance.
8. Promote the approved consent, storage, training, model-distribution, and regression policy into the PRD and architecture before implementation or data collection.

### Completion criteria

- Every stored invoice has auditable consent, retention, deletion, access, annotation, and provenance records in systems separate from group and production application data.
- The annotation schema represents the expected expense fields consistently, and reviewer agreement and adjudication meet documented quality thresholds.
- Training, validation, and held-out regression splits are versioned, reproducible, and protected against source-document or contributor leakage.
- Each candidate OCR or approved local-VLM artifact records its dataset version, training configuration, model hashes, licenses, and benchmark results.
- A dedicated automated comparison against the pinned production baseline blocks releases when OCR quality degrades beyond an approved overall or critical-slice budget.
- The shipped scanner remains local-first, and no member receipt is retained or used for training without the separately approved, explicit opt-in flow.

## LLM agent integration via a sanitized register

**Priority:** P2

**Status:** Exploration and security design required

Allow users to connect LLM agents directly to a group repository through an opt-in, machine-readable register maintained by GitHub Actions. The register would expose only an explicitly allowlisted, sanitized view of group activity so agents can answer questions, produce summaries, and help with planning without requiring access to raw expense files, member identities, credentials, or other sensitive repository data.

### Proposed direction

1. Define a versioned register schema with explicit inclusion, redaction, aggregation, and retention rules.
2. Add a GitHub Actions workflow that validates and regenerates the register when relevant group data changes.
3. Give agents read-only, least-privilege access to the sanitized register rather than the source data.
4. Preserve provenance so every generated value can be traced to a workflow run and source revision without exposing redacted content.
5. Make the integration opt-in, auditable, revocable, and safe against prompt injection or untrusted repository content.

### Completion criteria

- The sanitized register contains no credentials or member-identifying data outside the approved schema.
- GitHub Actions keeps the register synchronized with validated repository changes and fails closed when sanitization or validation fails.
- An authorized LLM agent can use the register without read access to raw group data.
- Users can inspect what is shared, disable the integration, and revoke agent access.
