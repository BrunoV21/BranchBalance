# BranchBalance Roadmap

**Last updated:** 2026-07-19

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
