/**
 * Headless-profile discovery test for the @flinter/dsh-segment S0 bundle: the
 * profile launcher composes its entry list by applying each bundle's patch
 * layer (base, headless, then the segment bundle) over an empty root. This
 * spec drives the real `composeEntries` machinery with the checked-in bundle
 * patch files and asserts the composed entry list contains the `dsh-segment`
 * row — proving the headless profile discovers the plugin the same way a `dsh
 * --profile headless` boot would.
 *
 * Pure function test over patch files: no Loader boot, no provider, no
 * network. Mirrors the app-boot `config-dump.spec.ts` import style.
 */

import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

const NAME = 'dsh-segment-loader-spec'

const basePatchPath = new URL('../../../packages/bundle/base/cordis.patch.yml', import.meta.url)
const headlessPatchPath = new URL('../../../packages/bundle/headless/cordis.patch.yml', import.meta.url)
const segmentPatchPath = new URL('../cordis.patch.yml', import.meta.url)

describe('dsh-segment S0 headless-profile discovery', () => {
  it('composes the dsh-segment row into the headless bundle entry list', () => {
    const baseLayer = loadOverlayPatches(NAME, fileURLToPath(basePatchPath))
    const headlessLayer = loadOverlayPatches(NAME, fileURLToPath(headlessPatchPath))
    const segmentLayer = loadOverlayPatches(NAME, fileURLToPath(segmentPatchPath))
    const entries = composeEntries([baseLayer, headlessLayer, segmentLayer])
    const row = entries.find(entry => entry.id === 'dsh-segment')
    expect(row).toMatchObject({ id: 'dsh-segment', name: '@flinter/dsh-segment' })
  })

  it('parses the base + headless layers successfully (sanity of the composition)', () => {
    const baseLayer = loadOverlayPatches(NAME, fileURLToPath(basePatchPath))
    const headlessLayer = loadOverlayPatches(NAME, fileURLToPath(headlessPatchPath))
    expect(baseLayer.length).toBeGreaterThan(0)
    expect(headlessLayer.length).toBeGreaterThan(0)
  })
})

// The loader smoke (keyless-smoke.e2e.ts) drives the same plugin through a
// real Loader boot; this file only proves the profile entry-list composition.
