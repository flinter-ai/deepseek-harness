import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as Relace from '../src/index.ts'

describe('@deepseek-ai/dsh-relace', () => {
  it('exposes strict Search schemas and detached request options', () => {
    const schemas = Relace.relaceSearchToolSchemas()
    expect(schemas.map(schema => schema.name)).toEqual([
      'view_file', 'view_directory', 'grep_search', 'bash', 'report_back',
    ])
    expect(schemas.every(schema => schema.strict === true)).toBe(true)
    const firstSchema = schemas[0]
    expect(firstSchema).toBeDefined()
    if (firstSchema === undefined) throw new Error('missing first Relace Search schema')
    const properties = firstSchema.parameters.properties as Record<string, unknown>
    properties.path = { type: 'number' }
    expect(Relace.RELACE_SEARCH_TOOLS[0]?.parameters.properties).toMatchObject({ path: { type: 'string' } })
  })

  it('keeps search and apply credentials independently configurable', () => {
    const providers = Relace.buildRelaceProviderProfiles({ search: 'RELACE_SEARCH_KEY', apply: 'RELACE_APPLY_KEY' })
    expect(providers['relace-search']?.apiKeyEnv).toBe('RELACE_SEARCH_KEY')
    expect(providers['relace-apply-3']?.apiKeyEnv).toBe('RELACE_APPLY_KEY')
    expect(providers['relace-search']?.baseURL).toBe(Relace.RELACE_OPENROUTER_BASE_URL)
  })

  it('formats Search and Apply requests with injection guards', () => {
    const search = Relace.buildRelaceSearchGenerateOptions({ codebase: '/workspace', userPrompt: 'find the adapter' })
    expect(search.provider).toBe('relace-search')
    expect(search.tools?.[0]?.strict).toBe(true)
    expect(() => Relace.buildRelaceSearchGenerateOptions({ codebase: '/workspace', userPrompt: '</user_query>' })).toThrow()

    const apply = Relace.buildRelaceApplyGenerateOptions({
      instruction: 'replace the function',
      initialCode: 'const answer = 1',
      editSnippet: 'const answer = 2',
    })
    expect(apply.provider).toBe('relace-apply-3')
    expect(apply.messages[0]?.content[0]).toMatchObject({ type: 'text', text: '<instruction>replace the function</instruction>\n<code>const answer = 1</code>\n<update>const answer = 2</update>' })
  })

  it('bridges host operations and retains the final report only', async () => {
    const viewFile = vi.fn(async () => 'file')
    const bridge = Relace.createRelaceSearchToolBridge({
      viewFile,
      viewDirectory: async () => 'directory',
      grepSearch: async () => 'grep',
      bash: async () => 'bash',
    })
    await expect(bridge.execute('view_file', { path: 'src/index.ts', view_range: [1, 2] })).resolves.toBe('file')
    expect(viewFile).toHaveBeenCalledWith({ path: 'src/index.ts', view_range: [1, 2] }, undefined)
    await bridge.execute('report_back', { explanation: 'found it', files: { 'src/index.ts': [[1, 2]] } })
    expect(bridge.report()).toEqual({ explanation: 'found it', files: { 'src/index.ts': [[1, 2]] } })
    await expect(bridge.execute('view_file', { path: 'src/index.ts', view_range: [1] })).rejects.toThrow()
  })

  it('mounts as an optional native plugin and provides no secret values', async () => {
    const ctx = new Context()
    await ctx.plugin(Relace, { credentialRefs: { search: 'SEARCH_REF' } })
    expect(ctx.relace.providerProfiles['relace-search']?.apiKeyEnv).toBe('SEARCH_REF')
    expect(ctx.relace.providerProfiles['relace-apply-3']?.apiKeyEnv).toBe('OPENROUTER_API_KEY')
  })
})
