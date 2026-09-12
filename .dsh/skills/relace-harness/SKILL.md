---
name: relace-harness
description: Use when a DSH harness task needs Relace Agent Search, Relace Apply-3, or the configured Kimi coding route; Search is read-only context gathering and Apply-3 produces an uncommitted candidate.
user-invocable: true
---

# Relace harness workflow

This skill belongs to the DSH harness. It does not change the DSH runner,
runner defaults, or a deployment entrypoint.

## Route selection

- Use the configured Kimi route for coding and reasoning when the current DSH
  profile exposes it. The established route is `ark-agent-plan` with model
  `kimi-k3`; verify that the active profile still exposes that model before
  selecting it. Do not invent a Relace-owned Kimi provider or credential.
- Add the exported `RELACE_PROVIDER_PROFILES` to the harness
  `llm-pi-ai.providers` map only when this workflow is enabled. The default
  uses the public credential reference `OPENROUTER_API_KEY` for both Relace
  routes. `buildRelaceProviderProfiles({ search: 'OPENROUTER_RELACE_SEARCH_API_KEY',
  apply: 'OPENROUTER_RELACE_APPLY_API_KEY' })` can instead receive separate
  references when Search and Apply are vaulted independently.
- Keep Search and Apply auxiliary. They must not replace the normal DSH model
  default or the Kimi route.

## Relace Agent Search

1. Build the request with `buildRelaceSearchGenerateOptions({ codebase,
   userPrompt })`.
2. Run at most `RELACE_SEARCH_MAX_TURNS` (five) turns. Make independent tool
   calls in parallel and finish with one `report_back` call.
3. Connect the five exact tool names through
   `createRelaceSearchToolBridge()`: `view_file`, `view_directory`,
   `grep_search`, `bash`, and `report_back`.
4. The host owns the security boundary. Resolve paths beneath the selected
   workspace, cap file/directory/search output, allow only read-only bounded
   commands for `bash`, and pass an abort signal through every callback.
5. Treat the report as analysis. Do not edit files from this route, and do not
   report speculative new files.

## Relace Apply-3

1. Call `buildRelaceApplyGenerateOptions()` only after Search or the Kimi route
   has supplied the intended edit context.
2. The user message must contain `<code>` and `<update>` tags. The optional
   `<instruction>` is one line. The builder rejects ambiguous closing tags and
   bounds the request before it reaches the provider.
3. Apply-3 is a separate one-shot route with no tools and no response-format
   hint. Parse the provider response with `parseRelaceApplyResponse()`.
4. Treat the returned merged code as a candidate. Review the diff, run the
   relevant tests, and use the normal DSH write/approval path before changing
   the workspace.

## Credential boundary

Profiles contain environment/reference names only. Never put an API key,
Bearer token, Jacq desktop `auth_token.enc`, or AWS secret value in this skill,
the prompt, source, logs, or a session record. The OpenRouter key used by
these profiles is not interchangeable with Jacq's encrypted desktop session
credential. AWS Secrets Manager mapping is a deployment concern and remains
read-only from the DSH runtime.
