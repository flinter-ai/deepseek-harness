import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import PacketEvidence, {
  DshSubprocessTransport,
  PacketEvidenceClient,
  PacketEvidenceError,
  apply,
} from '../src/index.ts'

const fixture = fileURLToPath(new URL('./fixtures/packet-service.mjs', import.meta.url))

async function tempClient() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-packet-evidence-'))
  const log = join(root, 'requests.jsonl')
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  const resolved = {
    command: process.execPath,
    args: [fixture, '--log', log],
    registryRoot: '/trusted/registry',
    cwd: process.cwd(),
    timeoutMs: 3_000,
    maxResponseBytes: 4_096,
    toolPrefix: 'flinter_',
  } as const
  const executable = await ctx.subprocess.resolveExecutable(resolved.command)
  const transport = new DshSubprocessTransport(ctx.subprocess, { ...resolved, executable })
  const client = new PacketEvidenceClient(transport)
  return { root, log, client, ctx, resolved, transport }
}

describe('PacketEvidenceClient', () => {
  it('uses compact packet-id requests and preserves caller ref order', async () => {
    const { root, log, client } = await tempClient()
    try {
      const result = await client.evidenceGet('pkt_demo', {
        refs: ['c2', 'c1', 'c2'],
        max_total_chars: 900,
        max_item_chars: 500,
        max_items: 2,
      })
      expect(result.ok).toBe(true)
      expect(result.packet_id).toBe('pkt_demo')
      const request = JSON.parse(await readFile(log, 'utf8'))
      expect(request).toEqual({
        id: 'dsh-1',
        method: 'evidence_get',
        params: {
          packet_id: 'pkt_demo', refs: ['c2', 'c1', 'c2'],
          max_total_chars: 900, max_item_chars: 500, max_items: 2,
        },
      })
      expect(JSON.stringify(request)).not.toContain('trace')
      expect(JSON.stringify(request)).not.toContain('/trusted/registry')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps Jacq materialization host-only and uses the same service', async () => {
    const { root, log, client } = await tempClient()
    try {
      const response = await client.materializeJacq('pkt_demo', '/isolated/jacq', {
        max_total_chars: 800,
        max_item_chars: 300,
        max_items: 1,
      })
      expect(response.operation).toBe('materialize_snapshot')
      const request = JSON.parse(await readFile(log, 'utf8'))
      expect(request.params).toEqual({
        packet_id: 'pkt_demo', output_dir: '/isolated/jacq',
        max_total_chars: 800, max_item_chars: 300, max_items: 1,
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects invalid configuration before registering tools or spawning a process', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(ToolRuntime)
    await expect(apply(ctx, {
      command: process.execPath,
      args: ['--registry-root', '/wrong'],
      registryRoot: '/trusted/registry',
    })).rejects.toThrow(/must not provide --registry-root/u)
    expect(ctx.tools?.schemas?.() ?? []).toHaveLength(0)
  })

  it('rejects cancellation and process response overflow', async () => {
    const { root, client, ctx, resolved } = await tempClient()
    try {
      const controller = new AbortController()
      controller.abort()
      await expect(client.packetDescribe('pkt_demo', controller.signal)).rejects.toMatchObject({
        code: 'ABORTED', name: 'AbortError',
      })
      const oversizedConfig = {
        ...resolved,
        args: [fixture, '--log', join(root, 'oversized.jsonl')],
        maxResponseBytes: 256,
      } as const
      const oversizedExecutable = await ctx.subprocess.resolveExecutable(oversizedConfig.command)
      const oversized = new PacketEvidenceClient(new DshSubprocessTransport(ctx.subprocess, {
        ...oversizedConfig,
        executable: oversizedExecutable,
      }))
      await expect(oversized.packetDescribe('pkt_demo')).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('PacketEvidence plugin', () => {
  it('registers dynamic tools and bounded guidance on a DSH context', async () => {
    const { root, log } = await tempClient()
    try {
      const ctx = new Context()
      await ctx.plugin(LocalSubprocessRuntime)
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await apply(ctx, {
        command: process.execPath,
        args: [fixture, '--log', log],
        registryRoot: '/trusted/registry',
        timeoutMs: 3_000,
        maxResponseBytes: 4_096,
      })
      expect(ctx.tools.schemas().map(tool => tool.name)).toEqual([
        'flinter_packet_describe', 'flinter_evidence_get',
      ])
      const assembly = await ctx.systemPrompt.assemble()
      expect(assembly.sections.find(section => section.name === 'tool:packet-evidence')?.text)
        .toContain('opaque `packet_id`')
      const result = await ctx.tools.execute({
        callId: ToolCallId('packet-tool'),
        name: 'flinter_evidence_get',
        arguments: { packet_id: 'pkt_demo', refs: ['c1'], max_items: 1 },
        signal: new AbortController().signal,
      })
      expect(result.isError).toBe(false)
      expect(result.value).toMatchObject({ ok: true, packet_id: 'pkt_demo' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('exports a directly attachable plugin object', () => {
    expect(PacketEvidence.name).toBe('packet-evidence')
    expect(PacketEvidence.inject).toEqual(['tools', 'systemPrompt', 'subprocess'])
  })

  it('does not mount without the native subprocess capability', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(PacketEvidence, {
      command: process.execPath,
      args: [fixture],
      registryRoot: '/trusted/registry',
    })
    // Cordis leaves a plugin with an unsatisfied injection pending rather than
    // invoking its callback. The capability therefore never registers tools.
    expect(fiber.state).toBe(0)
    expect(ctx.tools?.schemas?.() ?? []).toHaveLength(0)
  })

  it('resolves the service executable once at capability load', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-packet-evidence-resolve-'))
    const log = join(root, 'requests.jsonl')
    try {
      const ctx = new Context()
      await ctx.plugin(LocalSubprocessRuntime)
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      const resolve = vi.spyOn(ctx.subprocess, 'resolveExecutable')
      await apply(ctx, {
        command: process.execPath,
        args: [fixture, '--log', log],
        registryRoot: '/trusted/registry',
      })
      expect(resolve).toHaveBeenCalledTimes(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not expose materialization as a model-facing tool', async () => {
    const { root, log } = await tempClient()
    try {
      const ctx = new Context()
      await ctx.plugin(LocalSubprocessRuntime)
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await apply(ctx, {
        command: process.execPath,
        args: [fixture, '--log', log],
        registryRoot: '/trusted/registry',
        timeoutMs: 3_000,
        maxResponseBytes: 4_096,
      })
      expect(ctx.tools.schemas().some(tool => tool.name.includes('materialize'))).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

// Keep the imported error type part of the public test surface so accidental
// removal of the stable failure contract is caught by type-checking.
expect(PacketEvidenceError).toBeDefined()
