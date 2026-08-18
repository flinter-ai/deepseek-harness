/**
 * Type declarations for failure-classifier.mjs.
 * The runtime module is plain ESM and is imported by dsh-agent.mjs.
 */

/**
 * Whether a failed DSH launch should retry with the fallback model.
 * @param stderr - combined stdout/stderr captured from the launch.
 * @returns true when the fallback should be attempted.
 */
export declare function isProviderError(stderr: string | undefined): boolean
