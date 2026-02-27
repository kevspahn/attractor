/**
 * AST transforms — functions that modify the graph after parsing and before validation.
 *
 * Pipeline: parse -> transforms -> validate -> execute
 *
 * See spec Section 9.1.
 */

import type { Graph } from "../parser/types.js";
import { VariableExpansionTransform } from "./variable-expansion.js";
import { StylesheetApplicationTransform } from "./stylesheet-application.js";

/**
 * Transform interface — modifies the pipeline graph.
 */
export interface Transform {
  name: string;
  apply(graph: Graph): Graph;
}

/**
 * Built-in transforms applied in order.
 */
export function getBuiltInTransforms(): Transform[] {
  return [
    new VariableExpansionTransform(),
    new StylesheetApplicationTransform(),
  ];
}

/**
 * Apply a list of transforms to a graph in order.
 */
export function applyTransforms(
  graph: Graph,
  transforms: Transform[],
): Graph {
  let result = graph;
  for (const transform of transforms) {
    result = transform.apply(result);
  }
  return result;
}

export { VariableExpansionTransform } from "./variable-expansion.js";
export { StylesheetApplicationTransform } from "./stylesheet-application.js";
