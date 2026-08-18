/** Runtime constructors and protocol constants for the investigation domain. */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { InvestigationErrorCode } from './domain.ts'

/** Version of the durable `investigation/change` payload. */
export const INVESTIGATION_CHANGE_VERSION = 1

/** Error returned by the investigation domain boundary. */
export class InvestigationError extends HarnessError {
  /**
   * @param message - human-readable rejection reason.
   * @param code - stable machine-routable classification.
   */
  // Keep the constructor to narrow HarnessError's string code at this boundary.
  // oxlint-disable-next-line typescript/no-useless-constructor -- type-only narrowing
  constructor(message: string, code: InvestigationErrorCode) {
    super(message, code)
  }
}
