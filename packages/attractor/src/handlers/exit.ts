/**
 * ExitHandler — no-op handler for pipeline exit point.
 *
 * Returns SUCCESS immediately. Goal gate enforcement
 * is handled by the execution engine (Section 3.4).
 *
 * See spec Section 4.4.
 */

import type { Handler } from "./handler.js";
import { StageStatus } from "../state/outcome.js";
import type { Outcome } from "../state/outcome.js";

export class ExitHandler implements Handler {
  async execute(): Promise<Outcome> {
    return { status: StageStatus.SUCCESS };
  }
}
