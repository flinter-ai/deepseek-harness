/**
 * Regression tests for the explicitly locale-aware Cordis catalog surface
 * (`ZH_CATALOG_PROSE` → `localizeZhCatalogProse`): the generated Chinese
 * region carries reviewed Simplified-Chinese prose for the keyed service
 * while signatures, decorators, anchors, and links keep the projection's own
 * bytes, and a stale declaration fails regeneration closed instead of
 * silently passing English through. These fail on the pre-localization
 * behavior, where the English projection bytes reached the zh page verbatim.
 */

import { describe, expect, it } from 'vitest'
import { renderPageRegion } from '@deepseek-ai/dsh-typert-generator'
import type { CordisCatalogPolicy, ServiceEntry } from '@deepseek-ai/dsh-typert-generator'
import {
  localizeZhCatalogProse,
  methodNameOfSignature,
  SERVICE_PAGE,
  ZH_CATALOG_PROSE,
  zhCatalogProseProblems,
} from './gen-cordis-catalog.ts'
import { canonicalCatalogTsCode } from './translation-pairing.ts'

/** Render the flinterDecisionTrace service the way the projection does. */
function decisionTraceService(overrides: Partial<ServiceEntry> = {}): ServiceEntry {
  return {
    key: 'flinterDecisionTrace',
    type: 'DecisionTraceService',
    abstract: false,
    doc: 'Registry used by producer plugins to opt exact tool names into capture.',
    methods: [
      {
        kind: 'method',
        jsDoc: '/**\n * Register one exact tool-name adapter until the returned disposer runs.\n * @param toolName - exact DSH tool name owned by the producer.\n * @param adapter - trusted same-process projection callbacks.\n * @returns a disposer that removes this registration when it still owns the name.\n */',
        signature: 'register(toolName: string, adapter: DecisionTraceAdapter): () => void',
      },
      {
        kind: 'method',
        jsDoc: '/**\n * Find the adapter registered for one exact tool name.\n * @param toolName - exact DSH tool name.\n * @returns its adapter, or undefined when capture is not enabled.\n */',
        signature: 'adapter(toolName: string): DecisionTraceAdapter | undefined',
      },
      {
        kind: 'method',
        jsDoc: '/**\n * Record one bounded internal failure code without thrown data.\n * @param code - closed diagnostic code selected by the capture observer.\n */',
        signature: 'recordDiagnostic(code: DiagnosticCode): void',
      },
    ],
    source: 'packages/flinter/dsh-decision-trace/src/index.ts:76',
    ...overrides,
  }
}

const policy = { linkedTypePages: {} } as unknown as CordisCatalogPolicy

function regionFor(service: ServiceEntry, page = 'extensions.md'): string {
  return renderPageRegion(page, [service], [], policy)
}

const ZH = ZH_CATALOG_PROSE.flinterDecisionTrace
if (ZH === undefined) throw new Error('test requires the flinterDecisionTrace localization entry')

describe('localizeZhCatalogProse', () => {
  it('injects the declared zh prose keyed by service and method, keeping every other byte', () => {
    const en = regionFor(decisionTraceService())
    const zh = localizeZhCatalogProse(en, 'extensions.md')
    expect(zh).toContain(ZH.doc)
    expect(zh).not.toContain('Registry used by producer plugins')
    for (const jsDoc of Object.values(ZH.methods ?? {})) expect(zh).toContain(jsDoc)
    // Signatures, headings, and source pointers are untouched.
    expect(zh).toContain('register(toolName: string, adapter: DecisionTraceAdapter): () => void')
    expect(zh).toContain('adapter(toolName: string): DecisionTraceAdapter | undefined')
    expect(zh).toContain('recordDiagnostic(code: DiagnosticCode): void')
    expect(zh).toContain('### `ctx.flinterDecisionTrace` — `DecisionTraceService`')
    expect(zh).toContain('packages/flinter/dsh-decision-trace/src/index.ts')
    // Scaffold parity: the pairing gate's canonical form of every localized
    // block equals the English original's — prose differs, tags cannot.
    const service = decisionTraceService()
    for (const [name, jsDoc] of Object.entries(ZH.methods ?? {})) {
      const original = service.methods.find(method => methodNameOfSignature(method.signature) === name)
      expect(canonicalCatalogTsCode(jsDoc)).toBe(canonicalCatalogTsCode(original?.jsDoc ?? ''))
    }
  })

  it('passes regions for pages without localized services through byte-identical', () => {
    const service = decisionTraceService({ key: 'otherService', type: 'Other' })
    const region = renderPageRegion('other.md', [service], [], policy)
    expect(localizeZhCatalogProse(region, 'core.md')).toBe(region)
  })

  it('fails closed when the declared service no longer renders on its page', () => {
    const region = regionFor(decisionTraceService({ key: 'otherService', type: 'Other' }))
    expect(() => localizeZhCatalogProse(region, 'extensions.md')).toThrow('did not render')
  })

  it('fails closed when a declared method is absent from the rendered fence', () => {
    const region = regionFor(decisionTraceService({
      methods: decisionTraceService().methods.slice(0, 1),
    }))
    expect(() => localizeZhCatalogProse(region, 'extensions.md')).toThrow('did not render')
  })
})

describe('zhCatalogProseProblems', () => {
  it('accepts the committed declaration against a faithful projection', () => {
    expect(zhCatalogProseProblems([decisionTraceService()])).toEqual([])
  })

  it('rejects a service key the projection no longer renders', () => {
    expect(zhCatalogProseProblems([], { ghost: { doc: '幽灵。' } }))
      .toEqual([expect.stringContaining("ZH_CATALOG_PROSE names 'ctx.ghost'")])
  })

  it('rejects a method name the rendered service no longer exposes', () => {
    const problems = zhCatalogProseProblems([decisionTraceService()], {
      flinterDecisionTrace: { methods: { ghost: '/** 幽灵。 */' } },
    })
    expect(problems).toEqual([expect.stringContaining("names method 'ghost' of ctx.flinterDecisionTrace")])
  })

  it('rejects a localized JSDoc whose tag scaffold drifted from the English original', () => {
    const problems = zhCatalogProseProblems([decisionTraceService()], {
      flinterDecisionTrace: {
        methods: {
          register: [
            '/**',
            ' * 注册一个准确工具名的适配器。',
            ' * @param adapter - 可信的同进程投影回调。',
            ' * @returns 一个解除函数。',
            ' */',
          ].join('\n'),
        },
      },
    })
    expect(problems).toEqual([expect.stringContaining('no longer matches the English tag scaffold')])
  })
})

describe('methodNameOfSignature', () => {
  it('extracts the member name across decorators and modifiers', () => {
    expect(methodNameOfSignature('register(toolName: string): () => void')).toBe('register')
    expect(methodNameOfSignature('async invoke( pluginId: string ): Promise<void>')).toBe('invoke')
    expect(methodNameOfSignature('@Remote(\'invoke\') async invoke( id: string ): Promise<void>')).toBe('invoke')
    expect(methodNameOfSignature('generic<T>(value: T): T')).toBe('generic')
    expect(methodNameOfSignature('readonly snapshot: Snapshot')).toBeUndefined()
  })

  it('maps every declared localization key to exactly one subsystems page', () => {
    for (const key of Object.keys(ZH_CATALOG_PROSE)) {
      expect(SERVICE_PAGE, `ZH_CATALOG_PROSE declares ctx.${key} with no SERVICE_PAGE entry`).toHaveProperty(key)
    }
  })
})
