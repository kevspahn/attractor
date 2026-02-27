/**
 * Condition expression evaluator.
 *
 * Evaluates boolean conditions on edges for routing decisions.
 * Supports: key=value, key!=value, clause && clause
 *
 * See spec Section 10 for full details.
 */

import { Context } from "./state/context.js";
import { Outcome } from "./state/outcome.js";

/**
 * Resolve a condition key to its string value.
 *
 * Resolution order:
 * 1. "outcome" -> outcome.status
 * 2. "preferred_label" -> outcome.preferredLabel
 * 3. "context.*" -> context lookup (with and without prefix)
 * 4. Direct context lookup for unqualified keys
 * 5. Fallback: empty string
 */
export function resolveKey(
  key: string,
  outcome: Outcome,
  context: Context,
): string {
  const trimmedKey = key.trim();

  if (trimmedKey === "outcome") {
    return outcome.status;
  }

  if (trimmedKey === "preferred_label") {
    return outcome.preferredLabel ?? "";
  }

  if (trimmedKey.startsWith("context.")) {
    // Try with full "context.*" key
    const value = context.get(trimmedKey);
    if (value !== undefined && value !== null) {
      return String(value);
    }
    // Try without "context." prefix
    const shortKey = trimmedKey.slice("context.".length);
    const shortValue = context.get(shortKey);
    if (shortValue !== undefined && shortValue !== null) {
      return String(shortValue);
    }
    return "";
  }

  // Direct context lookup for unqualified keys
  const value = context.get(trimmedKey);
  if (value !== undefined && value !== null) {
    return String(value);
  }

  return "";
}

/**
 * Evaluate a single clause like "key=value" or "key!=value".
 */
export function evaluateClause(
  clause: string,
  outcome: Outcome,
  context: Context,
): boolean {
  const trimmed = clause.trim();
  if (trimmed === "") return true;

  // Check for != first (before = to avoid matching the = in !=)
  const neqIdx = trimmed.indexOf("!=");
  if (neqIdx !== -1) {
    const key = trimmed.slice(0, neqIdx).trim();
    const value = trimmed.slice(neqIdx + 2).trim();
    return resolveKey(key, outcome, context) !== value;
  }

  // Check for =
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx !== -1) {
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    return resolveKey(key, outcome, context) === value;
  }

  // Bare key: check if truthy
  const resolved = resolveKey(trimmed, outcome, context);
  return resolved !== "" && resolved !== "false" && resolved !== "0";
}

/**
 * Evaluate a full condition expression.
 * Empty condition always returns true (unconditional edge).
 * Clauses are AND-combined with "&&".
 */
export function evaluateCondition(
  condition: string,
  outcome: Outcome,
  context: Context,
): boolean {
  if (!condition || condition.trim() === "") {
    return true;
  }

  const clauses = condition.split("&&");
  for (const clause of clauses) {
    const trimmed = clause.trim();
    if (trimmed === "") continue;
    if (!evaluateClause(trimmed, outcome, context)) {
      return false;
    }
  }

  return true;
}

/**
 * Validate that a condition string parses correctly.
 * Returns null if valid, or an error message if invalid.
 */
export function validateConditionSyntax(condition: string): string | null {
  if (!condition || condition.trim() === "") {
    return null; // empty is valid
  }

  const clauses = condition.split("&&");
  for (const clause of clauses) {
    const trimmed = clause.trim();
    if (trimmed === "") continue;

    // Must have either = or != or be a bare key
    const neqIdx = trimmed.indexOf("!=");
    const eqIdx = trimmed.indexOf("=");

    if (neqIdx !== -1) {
      // key!=value
      const key = trimmed.slice(0, neqIdx).trim();
      if (key === "") {
        return `Empty key in clause: "${trimmed}"`;
      }
    } else if (eqIdx !== -1) {
      // key=value
      const key = trimmed.slice(0, eqIdx).trim();
      if (key === "") {
        return `Empty key in clause: "${trimmed}"`;
      }
    }
    // bare key is always valid
  }

  return null;
}
