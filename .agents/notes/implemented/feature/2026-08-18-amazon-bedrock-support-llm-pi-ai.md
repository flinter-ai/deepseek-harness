# Agent Note: Amazon Bedrock support in llm-pi-ai

Status: implemented

English | [中文](2026-08-18-amazon-bedrock-support-llm-pi-ai.zh.md)

## Problem

DSH agents running inside AWS need to call Amazon Bedrock models without leaving the AWS credential chain. The `dsh-llm-pi-ai` adapter previously excluded Bedrock because its configuration shape — `apiKeyEnv`, `baseURL`, and headers — could not express SigV4 signing or AWS region selection. Deployments that wanted Bedrock had to front it with an OpenAI-compatible gateway, adding infrastructure and losing pi-ai's native Bedrock streaming behavior.

## Decision

### Expose `bedrock-converse-stream` through the existing protocol table

`bedrock-converse-stream` is added to `PROTOCOLS` and `supportedProtocols()`. The pi-ai catalog already ships `amazon-bedrock` with the current Bedrock model list, so a minimal profile is `providers: { amazon-bedrock: {} }`. Hand-declared Bedrock routes are also possible by naming `api: bedrock-converse-stream` with an explicit `models` list.

### AWS-native credential resolution

Bedrock credentials resolve through the standard AWS credential chain: environment variables (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`), `AWS_PROFILE`, ECS task roles, and web identity tokens. Inside AWS (ECS, Fargate, AgentBox), the task role or instance profile supplies credentials automatically, so `apiKeyEnv` is not required. `apiKeyEnv` remains available for bearer-token deployments that use `AWS_BEARER_TOKEN_BEDROCK`.

### Optional `region` and `profile` profile fields

`PiAiProviderProfile` gains optional `region` and `profile` fields. `region` pins the Bedrock endpoint when the model ARN and environment do not decide it. `profile` selects an AWS profile when the default credential chain should not be used. Both fields are passed through pi-ai's stream options to the Bedrock provider.

## Alternatives considered

**Keep Bedrock out of `llm-pi-ai` and require an OpenAI-compatible gateway.** This avoids DSH changes but adds a permanent network hop, a new failure point, and loses pi-ai's native Bedrock streaming and replay state.

**Add a generic `env` bag to every provider profile.** A generic key-value bag would leak provider-specific configuration into the schema and make validation impossible. Named `region` and `profile` fields are explicit and reviewable.

**Store AWS credentials in DSH's credential store.** DSH's credential seam is designed for API keys, not AWS's rotating, role-based credentials. The AWS credential chain is the correct authority; DSH should not copy or cache IAM credentials.

## Consequences

- A DSH agent running in ECS/Fargate can use `amazon-bedrock` with zero stored credentials.
- Bearer-token Bedrock deployments remain supported through `apiKeyEnv`.
- The config schema now carries two AWS-specific optional fields; no other provider is affected.
- The existing narrow-protocol invariant is preserved: Vertex, Azure, and Codex remain excluded because their auth still cannot be expressed with the supported config shape.

## Testing

- `packages/llm/llm-pi-ai/tests/catalog.spec.ts` covers protocol exposure, catalog route resolution with and without `region`/`profile`, and provider construction.
- The full `llm-pi-ai` test suite passes (219 tests).
