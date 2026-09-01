/**
 * Narrow cross-package profile-resolution seam for sibling provider adapters.
 * The resolver remains off the package root so adapter internals do not become
 * part of the primary plugin surface.
 *
 * @module @deepseek-ai/dsh-llm-pi-ai/profile
 */

export { resolveProfiles } from './config.ts'
export type { PiAiProviderProfile, ResolvedPiAiProviderProfile } from './config.ts'
