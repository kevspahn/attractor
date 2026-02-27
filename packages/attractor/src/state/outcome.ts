/**
 * StageStatus and Outcome types.
 *
 * See spec Section 5.2 for full details.
 */

export const StageStatus = {
  SUCCESS: "success",
  PARTIAL_SUCCESS: "partial_success",
  RETRY: "retry",
  FAIL: "fail",
  SKIPPED: "skipped",
} as const;

export type StageStatus = (typeof StageStatus)[keyof typeof StageStatus];

/**
 * The result of executing a node handler.
 * Drives routing decisions and state updates.
 */
export interface Outcome {
  /** Outcome status: success, partial_success, retry, fail, skipped */
  status: StageStatus;
  /** Which edge label to follow (optional) */
  preferredLabel?: string;
  /** Explicit next node IDs (optional) */
  suggestedNextIds?: string[];
  /** Key-value pairs to merge into context */
  contextUpdates?: Record<string, unknown>;
  /** Human-readable execution summary */
  notes?: string;
  /** Reason for failure (when status is FAIL or RETRY) */
  failureReason?: string;
}
