# DSH GitHub source publisher

`@deepseek-ai/dsh-host-source-publisher-github` is the opt-in Host half of the
source-draft flow. It creates a clean temporary worktree from the draft's exact
`baseSha`, writes only the submitted relative files, runs Git checks, commits
and pushes a generated branch, and creates a GitHub Pull Request.

The browser receives only the branch, commit, and PR URL. The GitHub token is
resolved by the Host at publish time from a deployment-owned callback (the Web
composition uses `GITHUB_TOKEN` by default); it is never accepted from a
browser draft, memory MCP, prompt, or Session event.

The default Web bundle does not enable this publisher. Add the package as an
explicit Host row with `owner` and `repo`, and configure a repository allow-list
when the deployment should publish only one checkout.

## Model Experience

### Human Pull Request publication

#### What the model sees

Nothing directly. `GitHubSourcePublisher` creates a Git branch and Pull Request for the human source editor; it does not add prompts, tools, message content, schemas, or model-visible session events.

#### Token effect

None; the adapter does not assemble or send provider requests.

#### KV Cache effect

None; Git publication does not change model history or provider cache.

## Known Limitations and Deferred Work

- **GitHub-only provider** — the current adapter targets GitHub's Pull Request
  API. GitLab, Bitbucket, and Azure DevOps require separate Host adapters.
- **Deployment-owned credentials** — the default Web composition is inert until
  `owner`, `repo`, and a Host token environment are configured; browser drafts
  cannot enable publication or supply credentials.
- **No merge automation** — the adapter creates and pushes a PR branch but does
  not approve, merge, or deploy the resulting Pull Request.
