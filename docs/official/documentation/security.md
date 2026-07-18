---
title: Credential security
description: How BranchBalance stores, rotates, and clears GitHub credentials on Android.
---

# Credential security

BranchBalance uses GitHub App device flow. It never ships a GitHub client secret.

## Stored securely on-device

The access token, refresh token, and both expiries are stored together in `expo-secure-store`. Non-secret account and group snapshots use ordinary local app storage and remain disposable caches.

## Rotating credentials

Before an authenticated request, BranchBalance checks token expiry. Only one refresh request runs at a time, and successful refresh replaces the entire credential record atomically because GitHub refresh tokens rotate.

An unexpected `401` triggers one refresh and one retry. Invalid, expired, or revoked refresh credentials clear the session and account-scoped cache instead of entering a retry loop.

## Repository secrets

Never commit a GitHub token, client secret, Android keystore, signing credential, or populated environment file. Expo public variables are appropriate only for the GitHub App client ID and slug, which are public metadata.

See the [architecture security requirements](../reference/architecture#12-security-and-privacy) for implementation-level details.
