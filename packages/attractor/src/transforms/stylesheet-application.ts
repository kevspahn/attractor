/**
 * Stylesheet Application Transform.
 *
 * Applies the model_stylesheet to resolve llm_model, llm_provider,
 * and reasoning_effort for each node.
 *
 * See spec Section 8 and 9.2.
 */

import type { Graph } from "../parser/types.js";
import { applyStylesheetString } from "../stylesheet.js";
import type { Transform } from "./index.js";

export class StylesheetApplicationTransform implements Transform {
  name = "stylesheet-application";

  apply(graph: Graph): Graph {
    applyStylesheetString(graph);
    return graph;
  }
}
