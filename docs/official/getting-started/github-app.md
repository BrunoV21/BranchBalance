---
title: Configure the GitHub App
description: Enable device flow and the repository permissions BranchBalance needs.
---

# Configure the GitHub App

Create a GitHub App under **GitHub Settings → Developer settings → GitHub Apps**.

1. Enable **Device Flow**.
2. Grant repository **Contents** and **Administration** read/write permissions.
3. Keep expiring user authorization tokens enabled.
4. Configure the installation to cover all repositories so newly created groups are immediately accessible.
5. Copy the app’s client ID and slug into `.env`.

Do not copy or expose the client secret. GitHub App device-flow refresh does not require shipping it in the Android application.

Installation and authorization are separate GitHub actions. A group creator installs and authorizes the app; an invited collaborator authorizes it after accepting the repository invitation.
