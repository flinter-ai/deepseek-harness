# Agent Note: Keyless secret scanning in pull-request CI

Status: implemented

English | [中文](2026-08-29-keyless-secret-scanning-ci.zh.md)

## Problem

The public repository had GitHub secret scanning enabled, but pull-request CI did not independently reject newly introduced credentials and the default detector reported synthetic redaction values and generated documentation hash records as generic keys.

## Decision

Pull-request, branch-push, manual, and weekly scheduled CI runs two keyless scanners. Gitleaks v8.30.1 scans the checked-out tree and the changed commit range with redacted output. TruffleHog v3.97.1 scans the commit range for verified credentials. Both jobs have read-only contents permission, use pinned action or image revisions, and receive no provider or repository secrets.

The repository Gitleaks configuration allows only the exact generated bilingual-pair line format consisting of a Markdown filename and a 40-character lowercase hexadecimal blob hash inside an i18n YAML file. Two existing secret-shaped redaction fixtures carry an inline `gitleaks:allow` marker and remain test-only values. No directory-wide or detector-wide suppression is used.

The existing real-provider workflow remains the owner of its guarded credentialed tests. The scanner workflow does not inspect or consume those secrets, and its policy step rejects adding `pull_request_target` or a `secrets.*` reference to the scanner itself.

## Alternatives considered

**Rely only on GitHub secret scanning.** Rejected because repository-owner alerts are not the same as a required pull-request status and do not provide the local false-positive policy used by this repository.

**Allowlist all documentation, tests, or i18n files.** Rejected because a broad path exception could hide a real credential. The accepted exceptions match generated hash-record lines or an explicit fixture marker.

**Expose a scanner license or provider key to CI.** Rejected because scanning source does not require application credentials and the security gate must remain safe for fork pull requests.

**Delete the docs directory.** Rejected because the flagged documentation files are tracked architecture and generated-pair records; removal would discard repository material rather than address credential exposure.

## Consequences

New credentials present in the working tree or changed commit range fail CI without printing their values. Existing synthetic fixtures remain available to redaction tests and are visibly classified. Historical GitHub secret-scanning alerts and provider-specific rotation decisions remain separate operational responsibilities; this change does not claim that a generic detector finding is a confirmed secret.
