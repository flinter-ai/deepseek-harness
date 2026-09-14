#!/usr/bin/env node

/**
 * Private entry point for the EC2 runtime artifact.
 *
 * The artifact carries the normal DSH CLI plus the FLINTER profile roots in
 * one production dependency closure. It intentionally does not create a
 * second CLI or a second agent runtime.
 */
const { runCli } = await import('@deepseek-ai/dsh/lib/bin.js')
await runCli()
