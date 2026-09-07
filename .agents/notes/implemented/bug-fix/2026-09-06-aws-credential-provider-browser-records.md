# Agent Note: AWS credential provider keeps browser grants local

Status: implemented

English | [中文](2026-09-06-aws-credential-provider-browser-records.zh.md)

## Problem

The AWS credential-reference provider rejected record operations during DSH Web startup, while the browser connection layer uses a process-local grant record for its session cookie. Mounting the provider therefore caused the service to restart repeatedly even though model API-key resolution from Secrets Manager worked.

## Decision

The provider keeps credential records in an in-memory map for the lifetime of one DSH process. It supports read, describe, list, modify, and delete operations for those records without sending them to AWS. Model and provider API keys remain references resolved from Secrets Manager at request time, and AWS writes remain disabled by default.

## Alternatives considered

**Reject all record operations.** Rejected because the Web connection layer needs the record seam for its ephemeral browser grant, and rejecting it prevents the assembled Web profile from booting.

**Persist browser grants in Secrets Manager.** Rejected because browser authorization state is process-local and short-lived; storing it with deployment credentials would widen the secret store's responsibility and retention.

**Copy API keys into environment variables.** Rejected because request-time resolution keeps rotated values out of systemd configuration, `/proc`, and child-process inheritance.

## Consequences

Browser grants are lost and recreated when the DSH process restarts. AWS-backed API-key references remain available to each request without materializing their values in configuration or session records. The adapter's focused tests cover the complete local-record lifecycle and the read-only AWS reference path.
