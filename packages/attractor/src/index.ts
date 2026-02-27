export const VERSION = "0.1.0";

// Parser
export { tokenize, TokenType, LexerError } from "./parser/lexer.js";
export type { Token } from "./parser/lexer.js";
export { parseDot, deriveClassName, ParseError } from "./parser/parser.js";
export {
  createDefaultNode,
  createDefaultGraphAttributes,
  createDefaultEdge,
} from "./parser/types.js";
export type {
  Graph,
  Node,
  Edge,
  Subgraph,
  GraphAttributes,
} from "./parser/types.js";
export {
  parseDuration,
  parseAttributeValue,
  parseInteger,
  parseBoolean,
} from "./parser/values.js";

// State
export { Context } from "./state/context.js";
export { StageStatus } from "./state/outcome.js";
export type { Outcome } from "./state/outcome.js";
export {
  createCheckpoint,
  saveCheckpoint,
  loadCheckpoint,
} from "./state/checkpoint.js";
export type { Checkpoint } from "./state/checkpoint.js";
export { ArtifactStore } from "./state/artifact-store.js";
export type { ArtifactInfo } from "./state/artifact-store.js";

// Conditions
export {
  evaluateCondition,
  evaluateClause,
  resolveKey,
  validateConditionSyntax,
} from "./conditions.js";

// Stylesheet
export {
  parseStylesheet,
  applyStylesheet,
  applyStylesheetString,
  validateStylesheetSyntax,
  StylesheetParseError,
} from "./stylesheet.js";
export type {
  StyleRule,
  StyleSelector,
  StyleDeclaration,
} from "./stylesheet.js";

// Validator
export {
  validate,
  validateOrRaise,
  ValidationError,
  Severity,
} from "./validator.js";
export type {
  Diagnostic,
  LintRule,
} from "./validator.js";
