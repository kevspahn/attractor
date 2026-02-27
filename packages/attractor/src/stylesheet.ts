/**
 * Model stylesheet parser and applicator.
 *
 * Parses CSS-like rules for per-node LLM model/provider defaults.
 * Selectors: * (universal, specificity 0), .class (specificity 1), #id (specificity 2).
 * Properties: llm_model, llm_provider, reasoning_effort.
 *
 * See spec Section 8.
 */

import type { Graph, Node } from "./parser/types.js";

export interface StyleRule {
  selector: StyleSelector;
  declarations: StyleDeclaration[];
}

export interface StyleSelector {
  type: "universal" | "class" | "id";
  value: string;
  specificity: number;
}

export interface StyleDeclaration {
  property: string;
  value: string;
}

const RECOGNIZED_PROPERTIES = new Set([
  "llm_model",
  "llm_provider",
  "reasoning_effort",
]);

export class StylesheetParseError extends Error {
  constructor(message: string) {
    super(`Stylesheet parse error: ${message}`);
    this.name = "StylesheetParseError";
  }
}

/**
 * Parse a CSS-like stylesheet string into rules.
 */
export function parseStylesheet(source: string): StyleRule[] {
  const rules: StyleRule[] = [];
  const trimmed = source.trim();
  if (trimmed === "") return rules;

  let pos = 0;

  function skipWhitespace(): void {
    while (pos < trimmed.length && /\s/.test(trimmed[pos]!)) {
      pos++;
    }
  }

  function parseSelector(): StyleSelector {
    skipWhitespace();
    if (pos >= trimmed.length) {
      throw new StylesheetParseError("Expected selector");
    }

    const ch = trimmed[pos]!;

    if (ch === "*") {
      pos++;
      return { type: "universal", value: "*", specificity: 0 };
    }

    if (ch === ".") {
      pos++; // consume .
      const start = pos;
      while (pos < trimmed.length && /[a-z0-9-]/.test(trimmed[pos]!)) {
        pos++;
      }
      if (pos === start) {
        throw new StylesheetParseError("Expected class name after '.'");
      }
      const name = trimmed.slice(start, pos);
      return { type: "class", value: name, specificity: 1 };
    }

    if (ch === "#") {
      pos++; // consume #
      const start = pos;
      while (pos < trimmed.length && /[A-Za-z0-9_]/.test(trimmed[pos]!)) {
        pos++;
      }
      if (pos === start) {
        throw new StylesheetParseError("Expected ID after '#'");
      }
      const name = trimmed.slice(start, pos);
      return { type: "id", value: name, specificity: 2 };
    }

    throw new StylesheetParseError(`Unexpected character in selector: '${ch}'`);
  }

  function parseDeclarations(): StyleDeclaration[] {
    skipWhitespace();
    if (pos >= trimmed.length || trimmed[pos] !== "{") {
      throw new StylesheetParseError("Expected '{' after selector");
    }
    pos++; // consume {

    const declarations: StyleDeclaration[] = [];

    while (pos < trimmed.length) {
      skipWhitespace();
      if (trimmed[pos] === "}") {
        pos++; // consume }
        return declarations;
      }

      // Parse property name
      const propStart = pos;
      while (pos < trimmed.length && /[a-z_]/.test(trimmed[pos]!)) {
        pos++;
      }
      const property = trimmed.slice(propStart, pos);
      if (property === "") {
        throw new StylesheetParseError("Expected property name");
      }

      skipWhitespace();
      if (pos >= trimmed.length || trimmed[pos] !== ":") {
        throw new StylesheetParseError(`Expected ':' after property '${property}'`);
      }
      pos++; // consume :
      skipWhitespace();

      // Parse value
      const valueStart = pos;
      while (pos < trimmed.length && trimmed[pos] !== ";" && trimmed[pos] !== "}") {
        pos++;
      }
      const value = trimmed.slice(valueStart, pos).trim();

      if (value === "") {
        throw new StylesheetParseError(`Expected value for property '${property}'`);
      }

      declarations.push({ property, value });

      // Consume optional semicolon
      skipWhitespace();
      if (pos < trimmed.length && trimmed[pos] === ";") {
        pos++;
      }
    }

    throw new StylesheetParseError("Unterminated declaration block (missing '}')");
  }

  while (pos < trimmed.length) {
    skipWhitespace();
    if (pos >= trimmed.length) break;

    const selector = parseSelector();
    const declarations = parseDeclarations();
    rules.push({ selector, declarations });
  }

  return rules;
}

/**
 * Validate that a stylesheet string parses correctly.
 * Returns null if valid, or an error message if invalid.
 */
export function validateStylesheetSyntax(source: string): string | null {
  try {
    parseStylesheet(source);
    return null;
  } catch (err) {
    if (err instanceof StylesheetParseError) {
      return err.message;
    }
    return String(err);
  }
}

/**
 * Check if a style rule matches a node.
 */
function ruleMatchesNode(selector: StyleSelector, node: Node): boolean {
  switch (selector.type) {
    case "universal":
      return true;
    case "id":
      return node.id === selector.value;
    case "class": {
      if (!node.className) return false;
      const classes = node.className.split(",").map((c) => c.trim());
      return classes.includes(selector.value);
    }
    default:
      return false;
  }
}

/**
 * Apply a parsed stylesheet to a graph, mutating nodes in place.
 *
 * Only sets properties that are not already explicitly set on the node.
 * Later rules of equal specificity override earlier ones.
 * Explicit node attributes always override stylesheet values.
 */
export function applyStylesheet(graph: Graph, rules: StyleRule[]): void {
  for (const [, node] of graph.nodes) {
    // Collect matching rules sorted by specificity (lowest first, so higher overwrites)
    const matchingRules = rules
      .filter((rule) => ruleMatchesNode(rule.selector, node))
      .sort((a, b) => a.selector.specificity - b.selector.specificity);

    // Build a map of property -> value (later/higher specificity overwrites)
    const resolved: Record<string, string> = {};
    for (const rule of matchingRules) {
      for (const decl of rule.declarations) {
        resolved[decl.property] = decl.value;
      }
    }

    // Apply resolved properties, but only if not explicitly set on the node
    for (const [property, value] of Object.entries(resolved)) {
      if (!RECOGNIZED_PROPERTIES.has(property)) continue;

      switch (property) {
        case "llm_model":
          if (!node.explicitKeys.has("llm_model")) {
            node.llmModel = value;
          }
          break;
        case "llm_provider":
          if (!node.explicitKeys.has("llm_provider")) {
            node.llmProvider = value;
          }
          break;
        case "reasoning_effort":
          if (!node.explicitKeys.has("reasoning_effort")) {
            node.reasoningEffort = value;
          }
          break;
      }
    }
  }
}

/**
 * Parse and apply a stylesheet string to a graph.
 */
export function applyStylesheetString(graph: Graph): void {
  const source = graph.attributes.modelStylesheet;
  if (!source) return;
  const rules = parseStylesheet(source);
  applyStylesheet(graph, rules);
}
