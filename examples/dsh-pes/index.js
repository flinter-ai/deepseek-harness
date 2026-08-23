/**
 * @flinter/dsh-pes — searchable-trace plugin for DeepSeek Harness.
 *
 * Four native agent-facing tools over the searchable-trace engine
 * (`event_index.query`, producer SHA c05c3fc747… on flinter-ai/flinter-common
 * `feat/searchable-trace-engine`): SEARCH_EVENTS, FIND_SIMILAR_STATES,
 * FIND_COUNTERFACTUALS, ZOOM. Every tool reaches the engine ONLY through the
 * explicit configured command seam (engine.js): the CLI is spawned as a
 * subprocess with one JSON request line on stdin, never imported from a
 * sibling checkout or mutable branch at runtime.
 *
 * Results are bounded, structured envelopes: provenance + honest abstention
 * + stable error taxonomy (malformed-input, engine-timeout,
 * engine-nonzero-exit, engine-malformed-response, engine-unavailable,
 * artifact-reference-missing). Runtime engine packaging and pinning the
 * immutable producer SHA are integration-gate work — `engine_pin` is omitted
 * until a deployment pins it.
 */

export const name = 'dsh-pes'
export const inject = ['tools']

import { defineTool } from '@deepseek-ai/dsh-tools'
import { resolveEngineConfig } from './engine.js'
import { renderPesResult } from './render.js'
import {
  SEARCH_EVENTS,
  FIND_SIMILAR_STATES,
  FIND_COUNTERFACTUALS,
  ZOOM,
  searchEventsInput,
  findSimilarStatesInput,
  findCounterfactualsInput,
  zoomInput,
  dshPesResultFor,
  runQuery,
} from './query.js'

export function apply(ctx, config = {}) {
  const engine = resolveEngineConfig(config, process.env)
  const logger = ctx.logger

  const unregistered = [
    ctx.tools.register(defineTool({
      name: SEARCH_EVENTS,
      description: 'Search all indexed physical events with a natural-language query. Results are bounded and carry provenance; abstention and engine failures return structured results.',
      parameters: searchEventsInput,
      output: {
        schema: dshPesResultFor(SEARCH_EVENTS, 'search'),
        render: renderPesResult,
      },
      isConcurrencySafe: () => false,
      async execute(args) {
        return runQuery(SEARCH_EVENTS, args, engine)
      },
    })),
    ctx.tools.register(defineTool({
      name: FIND_SIMILAR_STATES,
      description: 'Find events whose pre-state matches a physical state (holding / on_surface). Honest abstention when no event carries an annotated pre-state.',
      parameters: findSimilarStatesInput,
      output: {
        schema: dshPesResultFor(FIND_SIMILAR_STATES, 'similar'),
        render: renderPesResult,
      },
      isConcurrencySafe: () => false,
      async execute(args) {
        return runQuery(FIND_SIMILAR_STATES, args, engine)
      },
    })),
    ctx.tools.register(defineTool({
      name: FIND_COUNTERFACTUALS,
      description: 'Find events from episodes with a start state similar to the given state but a DIFFERENT outcome than the one given. Honest abstention on unlabeled data.',
      parameters: findCounterfactualsInput,
      output: {
        schema: dshPesResultFor(FIND_COUNTERFACTUALS, 'counterfactual'),
        render: renderPesResult,
      },
      isConcurrencySafe: () => false,
      async execute(args) {
        return runQuery(FIND_COUNTERFACTUALS, args, engine)
      },
    })),
    ctx.tools.register(defineTool({
      name: ZOOM,
      description: 'Zoom into one episode: all events overlapping a frame window. Output is bounded to the engine result cap.',
      parameters: zoomInput,
      output: {
        schema: dshPesResultFor(ZOOM, 'zoom'),
        render: renderPesResult,
      },
      isConcurrencySafe: () => false,
      async execute(args) {
        return runQuery(ZOOM, args, engine)
      },
    })),
  ]

  if (logger) logger.info(`[dsh-pes] plugin loaded: engine command ${engine.command.join(' ')}; engine pin ${engine.enginePin ?? '(not pinned)'}`)
  ctx.on('dispose', () => {
    for (const unregister of unregistered) unregister()
  })
}
