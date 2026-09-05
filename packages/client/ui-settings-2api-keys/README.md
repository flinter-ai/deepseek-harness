# @deepseek-ai/dsh-client-ui-settings-2api-keys

English | [中文](README.zh.md)

The browser-only **2API keys** tab in Web Settings. It contributes a third tab to the existing Plugins section and manages the two credential references used by the local integrations: `WORKBUDDY_API_KEY` for DSH's WorkBuddy-compatible route and Gemini2API's main `API_KEY` for its admin surface and Chrome keep-alive plugin.

The Host describes each reference without returning its value, so the page shows only configured/source/writable metadata. Entering a key sends it once through `credentials.set`; removing one sends `credentials.unset`. The Host's local credentials provider persists the value in `$DSH_HOME/.credentials.yaml` with owner-only permissions, not in `settings.yaml`. A key supplied by a read-only launch environment is shown as read-only rather than pretending that a file write changed the effective value.

This page manages DSH's credential store. It does not edit `/Users/oldap/gemini2api/.env`, WorkBuddy's own process environment, or test whether either relay is reachable; those services must be restarted or configured separately when their own environment changes.

Each card also shows the machine-local restart command for its service and offers a copy button. The command is displayed only for the user to run in Terminal; the browser never executes it, and copying it does not synchronize the DSH credential store with either service's `.env` file.

## Model Experience

None, as this package renders a browser settings surface and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Two fixed references** — the tab intentionally manages only `WORKBUDDY_API_KEY` and `API_KEY`; it is not a general credential enumerator because the credential seam does not enumerate secret values.
- **No relay health check** — saving proves only that the DSH Host accepted the credential; it does not prove that WorkBuddy or Gemini2API is running or that the key is accepted by those services.
- **Copy-only restart instructions** — the tab shows the verified WorkBuddy and Gemini2API `launchd` commands, but it does not run shell commands or restart either service. Install the native Gemini2API launch agent before using its restart command.
- **Gemini2API remains an external consumer** — DSH stores `API_KEY` for the local relay integration, but this package does not add a Gemini model adapter or change the Chrome extension's URL and polling settings.
