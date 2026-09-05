# Agent Note: DSH 2API credential settings

Status: implemented

English | [中文](2026-09-05-dsh-2api-credential-settings.zh.md)

## Problem

The local DSH Web portal has a Host credential seam and separate local 2API services, but no single browser surface for the two keys needed by the WorkBuddy route and the Gemini2API admin relay. Putting either literal into `settings.yaml` would cross the settings redaction boundary and make the key part of ordinary configuration state.

## Decision

The Web composition mounts `@deepseek-ai/dsh-client-ui-settings-2api-keys`, a client-only plugin that contributes a `2API keys` tab to the existing Plugins settings section. The tab owns two fixed rows: `WORKBUDDY_API_KEY`, consumed by the existing WorkBuddy adapter, and Gemini2API's main `API_KEY`, consumed by the Gemini2API admin surface and Chrome keep-alive plugin when `ADMIN_API_KEY` is left empty.

Each row calls `credentials.describe` for configured/source/writable metadata and starts with a blank password input. A save sends the trimmed value only through `credentials.set`; a removal uses an inline confirmation before `credentials.unset`. The component never receives a resolved credential value, and generic UI failures do not echo transport or secret material. A read-only environment source disables editing and explains that the launch environment must change.

The package is a separate `dsh.client` bundle rather than a modification of the Plugins section owner. It follows the section's tab slot, owns its copy and CSS, and is added to the shipped Web browser roster. The tab manages DSH's credential store only; it does not rewrite the Gemini2API repository `.env`, alter WorkBuddy's service environment, add a Gemini model adapter, or perform relay health checks.

## Alternatives considered

**Write key values into `settings.yaml`.** Rejected: settings descriptors are redacted and settings are not the owner of secrets; a literal there would also broaden every configuration read and mutation path.

**Add the rows to the existing generic plugin-card package.** Rejected: this is a separate user-facing provider-key surface with no settings namespace, and the client bundle rules keep feature-owned tabs and value imports independent from the section owner.

**Create a Gemini model adapter as part of this change.** Deferred: the request is key management for the local relay and Chrome integration; routing Gemini requests through DSH would introduce a separate provider contract and model catalog decision.

## Consequences

The user can add, replace, inspect metadata for, and remove both local 2API keys from Settings. A successful write is durable in `$DSH_HOME/.credentials.yaml` and is available to consumers that resolve the matching reference on their next operation. The page proves acceptance by DSH's credential provider only; service reachability and external `.env` synchronization remain separate operations.

The references are deliberately fixed and visible so the page can manage the exact existing consumers without a secret enumeration API. Adding another provider requires a new explicit row and its consumer contract, rather than silently exposing arbitrary credential names. `ADMIN_API_KEY` remains an optional separate Gemini2API credential; it is intentionally not managed by this tab because the local deployment uses the main `API_KEY` fallback.

Each row also renders the verified machine-local restart command: the WorkBuddy `launchd` kickstart command or the Gemini2API local virtualenv launcher. A copy button writes only that static command to the browser clipboard; the page never executes shell commands and the command does not copy the DSH credential into either service's `.env` file.
