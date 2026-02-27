/**
 * StartHandler — no-op handler for pipeline entry point.
 *
 * Returns SUCCESS immediately. See spec Section 4.3.
 */

import type { Handler } from "./handler.js";
import { StageStatus } from "../state/outcome.js";
import type { Outcome } from "../state/outcome.js";

export class StartHandler implements Handler {
  async execute(): Promise<Outcome> {
    return { status: StageStatus.SUCCESS };
  }
}
