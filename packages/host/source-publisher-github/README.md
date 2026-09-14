---
description: "Host-only Git worktree and GitHub Pull Request publication for accepted browser source drafts."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-source-publisher-github

English | [中文](README.zh.md)

## Summary

Turn an accepted source draft into a GitHub Pull Request from a clean, request-scoped worktree. Use this Host package when DSH Web needs a controlled commit-back path; the browser supplies files and revision intent, while the Host owns repository access, credentials, Git checks, and the PR API.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### When to choose it

`@deepseek-ai/dsh-host-source-publisher-github` is the opt-in Host half of the source-draft flow. It creates a clean temporary worktree from the draft's exact `baseSha`, writes only the submitted relative files, runs Git checks, commits and pushes a generated branch, and creates a GitHub Pull Request.

The browser receives only the branch, commit, and PR URL. The GitHub token is resolved by the Host at publish time from a deployment-owned callback (the Web composition uses `GITHUB_TOKEN` by default); it is never accepted from a browser draft, memory MCP, prompt, or Session event.

The default Web bundle does not enable this publisher. Add the package as an explicit Host row with `owner` and `repo`, and configure a repository allow-list when the deployment should publish only one checkout.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The publisher verifies the draft base before creating a temporary worktree, applies only validated relative files, and runs the repository's Git checks before the commit. It resolves the token inside the Host process and returns branch, commit, and optional PR URL metadata. The browser and model never receive the token.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Source controller](../../api/source-controller/README.md) — draft validation and publication seam.
- [Workspace package](../../workspace/workspace/README.md) — repository and worktree helpers.
- [Configuration catalog](../../../docs/config-catalog.md) — generated package metadata.

-----

## Model Experience

### Human Pull Request publication

#### What the model sees

Nothing directly. `GitHubSourcePublisher` creates a Git branch and Pull Request for the human source editor; it does not add prompts, tools, message content, schemas, or model-visible session events.

#### Token effect

None; the adapter does not assemble or send provider requests.

#### KV Cache effect

None; Git publication does not change model history or provider cache.

## Known Limitations and Deferred Work

- No runtime invariant companion is published because each publication uses request-scoped worktree state and exposes no package-owned background relationship.
- **GitHub-only provider** — the current adapter targets GitHub's Pull Request API. GitLab, Bitbucket, and Azure DevOps require separate Host adapters.
- **Deployment-owned credentials** — the default Web composition is inert until `owner`, `repo`, and a Host token environment are configured; browser drafts cannot enable publication or supply credentials.
- **No merge automation** — the adapter creates and pushes a PR branch but does not approve, merge, or deploy the resulting Pull Request.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
