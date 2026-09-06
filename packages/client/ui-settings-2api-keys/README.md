# @deepseek-ai/dsh-client-ui-settings-2api-keys

English | [中文](README.zh.md)

The browser-only local relay keys tab in Web Settings. It contributes a third tab to the existing Plugins section and manages three fixed credential references used by local integrations: `WORKBUDDY_API_KEY` for DSH's WorkBuddy-compatible route, Gemini2API's main `API_KEY`, and zcode2api's gateway `ZCODE_API_KEY`.

The Host describes each reference without returning its value, so the page shows only configured/source/writable metadata. Entering a key sends it once through `credentials.set`; removing one sends `credentials.unset`. The Host's local credentials provider persists the value in `$DSH_HOME/.credentials.yaml` with owner-only permissions, not in `settings.yaml`. A key supplied by a read-only launch environment is shown as read-only rather than pretending that a file write changed the effective value.

This page manages DSH's credential store. It does not edit `/Users/oldap/gemini2api/.env`, zcode2api's `.env`/SQLite store, WorkBuddy's own process environment, or test whether a relay is reachable; those services must be restarted or configured separately when their own environment changes.

Each card also shows the machine-local restart command for its service and offers a copy button. The command is displayed only for the user to run in Terminal; the browser never executes it, and copying it does not synchronize the DSH credential store with either service's `.env` file.

The zcode2api card additionally shows a copy-only rotation command for the native install. Run it to generate a new gateway key, restart zcode2api, paste the new key into Kimi Code’s `zcode2api` provider, and save the same key in the DSH card. This is the re-login/rebind step for clients; the page never executes the rotation command.

## Model Experience

None, as this package renders a browser settings surface and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Three fixed references** — the tab intentionally manages only `WORKBUDDY_API_KEY`, `API_KEY`, and `ZCODE_API_KEY`; it is not a general credential enumerator because the credential seam does not enumerate secret values.
- **No relay health check** — saving proves only that the DSH Host accepted the credential; it does not prove that a relay is running or that the key is accepted by that service.
- **Copy-only service commands** — the tab shows verified local `launchd` and zcode rotation commands, but it does not run shell commands or restart services. The service admin keys remain separate from these client gateway keys.
- **No service-store synchronization** — DSH stores client-side copies for worker launch; zcode2api and Gemini2API each retain their own authoritative local service configuration.
