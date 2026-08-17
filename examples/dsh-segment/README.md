# @flinter/dsh-segment

Production segment plugin for DeepSeek Harness. Registered inside the GMI
container by the `flinter-dsh-worker` image. Provides deterministic instruments
and judgement tools for episode segmentation.

This is a skeleton: each tool returns a stub artifact with a content hash so
the container boot → tool call → artifact write path can be proven without
TowerH/TowerT integration.

## Tools

| Tool | Purpose | Real implementation |
|---|---|---|
| `frames.sample` | Sample frames from a video window | DINOv2 self-similarity + Foote novelty |
| `track.cotracker` | Run CoTracker on a seeded window | CoTracker inside the container |
| `boundary.detect` | Detect candidate boundaries from a track | Foote novelty on self-similarity |
| `vlm.ask` | Ask a VLM a state question about frames | ARK/doubao with reasoning_effort=low |
| `artifact.write` | Write an artifact with content hash | B2 write with capability URL |

## Usage

The plugin is loaded by the `headless` profile in the container image. A DSH
session booted with this plugin can call the tools from the agent loop or from
subagents.

## Next steps

- Wire real samplers/trackers/detectors.
- Replace `artifact.write` stub with B2 capability-URL write.
- Add `ctx.userQuestions` adapter for Trigger.dev waitpoints.
- Add session-log shipping to B2 at teardown.
