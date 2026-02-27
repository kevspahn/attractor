/**
 * ConditionalHandler — pass-through for conditional routing nodes.
 *
 * Returns SUCCESS immediately. Edge condition evaluation
 * happens in the engine's edge selection algorithm (Section 3.3).
 *
 * See spec Section 4.7.
 */

import type { Node } from "../parser/types.js";
import type { Handler } from "./handler.js";
import { StageStatus } from "../state/outcome.js";
import type { Outcome } from "../state/outcome.js";

export class ConditionalHandler implements Handler {
  async execute(node: Node): Promise<Outcome> {
    return {
      status: StageStatus.SUCCESS,
      notes: `Conditional node evaluated: ${node.id}`,
    };
  }
}
