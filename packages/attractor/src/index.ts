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

// Handlers
export type { Handler } from "./handlers/handler.js";
export { HandlerRegistry, SHAPE_TO_TYPE } from "./handlers/registry.js";
export { StartHandler } from "./handlers/start.js";
export { ExitHandler } from "./handlers/exit.js";
export { CodergenHandler, expandVariables } from "./handlers/codergen.js";
export type { CodergenBackend } from "./handlers/codergen.js";
export { ConditionalHandler } from "./handlers/conditional.js";
export {
  WaitForHumanHandler,
  parseAcceleratorKey,
} from "./handlers/human.js";
export { ParallelHandler } from "./handlers/parallel.js";
export type { BranchResult, BranchExecutor } from "./handlers/parallel.js";
export { FanInHandler } from "./handlers/fan-in.js";
export { ToolHandler } from "./handlers/tool.js";
export { CodingAgentHandler } from "./handlers/coding-agent.js";
export type {
  AgentSession,
  AgentSessionFactory,
} from "./handlers/coding-agent.js";

// Interviewer
export {
  QuestionType,
  AnswerValue,
  AutoApproveInterviewer,
  ConsoleInterviewer,
  CallbackInterviewer,
  QueueInterviewer,
} from "./interviewer.js";
export type {
  Option,
  Question,
  Answer,
  Interviewer,
} from "./interviewer.js";

// Engine
export { PipelineEngine } from "./engine/engine.js";
export type {
  EngineConfig,
  ExecuteOptions,
  PipelineResult,
} from "./engine/engine.js";
export { selectEdge, normalizeLabel } from "./engine/edge-selection.js";
export {
  delayForAttempt,
  defaultShouldRetry,
  buildRetryPolicy,
  PRESET_POLICIES,
  sleep,
} from "./engine/retry.js";
export type {
  BackoffConfig,
  RetryPolicy,
} from "./engine/retry.js";
export {
  resolveFidelity,
  resolveThreadKey,
  buildFidelityContext,
  FIDELITY_TOKEN_BUDGETS,
} from "./engine/fidelity.js";
export type { FidelityMode } from "./engine/fidelity.js";
export { PipelineEventEmitter } from "./engine/events.js";
export type {
  PipelineEvent,
  EventListener,
  PipelineStartedEvent,
  PipelineCompletedEvent,
  PipelineFailedEvent,
  StageStartedEvent,
  StageCompletedEvent,
  StageFailedEvent,
  StageRetryingEvent,
  ParallelStartedEvent,
  BranchStartedEvent,
  BranchCompletedEvent,
  ParallelCompletedEvent,
  InterviewStartedEvent,
  InterviewCompletedEvent,
  InterviewTimeoutEvent,
  CheckpointSavedEvent,
} from "./engine/events.js";

// Transforms
export {
  applyTransforms,
  getBuiltInTransforms,
  VariableExpansionTransform,
  StylesheetApplicationTransform,
} from "./transforms/index.js";
export type { Transform } from "./transforms/index.js";

// Runner (top-level API)
export { PipelineRunner } from "./runner.js";
export type { RunnerConfig, RunOptions } from "./runner.js";
