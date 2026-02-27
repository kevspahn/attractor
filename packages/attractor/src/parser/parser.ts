/**
 * DOT parser — parses tokens from the lexer into a Graph structure.
 *
 * Handles: digraph, nodes, edges (including chained), subgraphs,
 * node/edge default blocks, graph attributes, and attribute blocks.
 */

import { tokenize, Token, TokenType } from "./lexer.js";
import {
  Graph,
  Node,
  Edge,
  Subgraph,
  GraphAttributes,
  createDefaultNode,
  createDefaultGraphAttributes,
  createDefaultEdge,
} from "./types.js";
import { parseDuration, parseBoolean, parseInteger } from "./values.js";

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly column: number,
  ) {
    super(`Parse error at ${line}:${column}: ${message}`);
    this.name = "ParseError";
  }
}

class Parser {
  private tokens: Token[];
  private pos: number = 0;

  // Scope stack for node/edge defaults
  private nodeDefaultsStack: Record<string, string>[] = [{}];
  private edgeDefaultsStack: Record<string, string>[] = [{}];

  // Collected results
  private nodes: Map<string, Node> = new Map();
  private edges: Edge[] = [];
  private subgraphs: Subgraph[] = [];
  private graphAttributes: GraphAttributes = createDefaultGraphAttributes();

  // Subgraph label tracking — when inside a subgraph, top-level `label = "..."` is captured here
  private subgraphLabelStack: string[] = [];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos]!;
  }

  private advance(): Token {
    const token = this.tokens[this.pos]!;
    this.pos++;
    return token;
  }

  private expect(type: TokenType): Token {
    const token = this.peek();
    if (token.type !== type) {
      throw new ParseError(
        `Expected ${type} but got ${token.type} ("${token.value}")`,
        token.line,
        token.column,
      );
    }
    return this.advance();
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private match(type: TokenType): Token | undefined {
    if (this.check(type)) {
      return this.advance();
    }
    return undefined;
  }

  parse(): Graph {
    this.expect(TokenType.DIGRAPH);
    const id = this.expect(TokenType.IDENTIFIER).value;
    this.expect(TokenType.LBRACE);
    this.parseStatements();
    this.expect(TokenType.RBRACE);

    // Should be at EOF
    if (!this.check(TokenType.EOF)) {
      const token = this.peek();
      throw new ParseError(
        `Unexpected token after graph: ${token.type} ("${token.value}")`,
        token.line,
        token.column,
      );
    }

    return {
      id,
      attributes: this.graphAttributes,
      nodes: this.nodes,
      edges: this.edges,
      subgraphs: this.subgraphs,
    };
  }

  private parseStatements(): void {
    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      this.parseStatement();
      this.match(TokenType.SEMICOLON); // optional semicolons
    }
  }

  private parseStatement(): void {
    const token = this.peek();

    switch (token.type) {
      case TokenType.GRAPH:
        this.parseGraphAttrStatement();
        return;
      case TokenType.NODE:
        this.parseNodeDefaults();
        return;
      case TokenType.EDGE:
        this.parseEdgeDefaults();
        return;
      case TokenType.SUBGRAPH:
        this.parseSubgraph();
        return;
      case TokenType.IDENTIFIER:
        this.parseNodeOrEdgeStatement();
        return;
      default:
        throw new ParseError(
          `Unexpected token: ${token.type} ("${token.value}")`,
          token.line,
          token.column,
        );
    }
  }

  private parseGraphAttrStatement(): void {
    this.advance(); // consume GRAPH
    if (this.check(TokenType.LBRACKET)) {
      const attrs = this.parseAttrBlock();
      this.applyGraphAttributes(attrs);
    }
  }

  private parseNodeDefaults(): void {
    this.advance(); // consume NODE
    if (this.check(TokenType.LBRACKET)) {
      const attrs = this.parseAttrBlock();
      const currentDefaults = this.currentNodeDefaults();
      Object.assign(currentDefaults, attrs);
    }
  }

  private parseEdgeDefaults(): void {
    this.advance(); // consume EDGE
    if (this.check(TokenType.LBRACKET)) {
      const attrs = this.parseAttrBlock();
      const currentDefaults = this.currentEdgeDefaults();
      Object.assign(currentDefaults, attrs);
    }
  }

  private parseSubgraph(): void {
    this.advance(); // consume SUBGRAPH

    let subId = "";
    if (this.check(TokenType.IDENTIFIER)) {
      subId = this.advance().value;
    }

    this.expect(TokenType.LBRACE);

    // Push new scope
    this.nodeDefaultsStack.push({ ...this.currentNodeDefaults() });
    this.edgeDefaultsStack.push({ ...this.currentEdgeDefaults() });
    this.subgraphLabelStack.push("");

    const nodesBefore = new Set(this.nodes.keys());

    // Parse statements within subgraph
    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      this.parseStatement();
      this.match(TokenType.SEMICOLON);
    }

    this.expect(TokenType.RBRACE);

    // Figure out which nodes were added in this subgraph
    const nodesAfter = new Set(this.nodes.keys());
    const nodeIds: string[] = [];
    for (const nodeId of nodesAfter) {
      if (!nodesBefore.has(nodeId)) {
        nodeIds.push(nodeId);
      }
    }

    // Capture scope defaults BEFORE popping
    const scopeNodeDefaults = this.currentNodeDefaults();
    const scopeEdgeDefaults = this.currentEdgeDefaults();

    // Pop subgraph label and scopes
    const subLabel = this.subgraphLabelStack.pop() || "";
    this.nodeDefaultsStack.pop();
    this.edgeDefaultsStack.pop();

    const subgraph: Subgraph = {
      id: subId,
      label: subLabel,
      nodeDefaults: scopeNodeDefaults,
      edgeDefaults: scopeEdgeDefaults,
      nodeIds,
    };

    // Derive class from subgraph label and apply to nodes
    if (subLabel) {
      const derivedClass = deriveClassName(subLabel);
      for (const nodeId of nodeIds) {
        const node = this.nodes.get(nodeId);
        if (node && !node.explicitKeys.has("class")) {
          node.className = node.className
            ? `${node.className},${derivedClass}`
            : derivedClass;
        }
      }
    }

    this.subgraphs.push(subgraph);
  }

  private parseNodeOrEdgeStatement(): void {
    const firstId = this.advance().value; // IDENTIFIER

    // Check for top-level key=value graph attribute declaration
    if (this.check(TokenType.EQUALS)) {
      this.advance(); // consume =
      const value = this.parseValue();
      // When inside a subgraph, intercept `label` to capture as subgraph label
      if (firstId === "label" && this.subgraphLabelStack.length > 0) {
        this.subgraphLabelStack[this.subgraphLabelStack.length - 1] = value;
      } else {
        this.applyGraphAttributes({ [firstId]: value });
      }
      return;
    }

    // Check if this is an edge statement (has ->)
    if (this.check(TokenType.ARROW)) {
      this.parseEdgeStatement(firstId);
      return;
    }

    // It's a node statement
    this.parseNodeStatement(firstId);
  }

  private parseNodeStatement(nodeId: string): void {
    const attrs = this.check(TokenType.LBRACKET)
      ? this.parseAttrBlock()
      : {};
    this.ensureNode(nodeId, attrs);
  }

  private parseEdgeStatement(firstId: string): void {
    // Collect chain: firstId -> id2 -> id3 ...
    const chain: string[] = [firstId];

    while (this.match(TokenType.ARROW)) {
      const nextId = this.expect(TokenType.IDENTIFIER).value;
      chain.push(nextId);
    }

    // Parse optional attr block
    const attrs = this.check(TokenType.LBRACKET)
      ? this.parseAttrBlock()
      : {};

    // Ensure all nodes in the chain exist
    for (const nodeId of chain) {
      this.ensureNode(nodeId, {});
    }

    // Create edges for each pair, applying defaults + attrs
    for (let i = 0; i < chain.length - 1; i++) {
      const source = chain[i]!;
      const target = chain[i + 1]!;
      const edge = this.buildEdge(source, target, attrs);
      this.edges.push(edge);
    }
  }

  private parseAttrBlock(): Record<string, string> {
    this.expect(TokenType.LBRACKET);
    const attrs: Record<string, string> = {};

    while (!this.check(TokenType.RBRACKET) && !this.check(TokenType.EOF)) {
      const key = this.parseKey();
      this.expect(TokenType.EQUALS);
      const value = this.parseValue();
      attrs[key] = value;

      // Optional comma between attributes
      this.match(TokenType.COMMA);
    }

    this.expect(TokenType.RBRACKET);
    return attrs;
  }

  private parseKey(): string {
    const token = this.peek();
    if (
      token.type === TokenType.IDENTIFIER ||
      token.type === TokenType.GRAPH ||
      token.type === TokenType.NODE ||
      token.type === TokenType.EDGE
    ) {
      return this.advance().value;
    }
    throw new ParseError(
      `Expected attribute key but got ${token.type} ("${token.value}")`,
      token.line,
      token.column,
    );
  }

  private parseValue(): string {
    const token = this.peek();
    switch (token.type) {
      case TokenType.STRING:
        return this.advance().value;
      case TokenType.INTEGER:
        return this.advance().value;
      case TokenType.FLOAT:
        return this.advance().value;
      case TokenType.BOOLEAN:
        return this.advance().value;
      case TokenType.IDENTIFIER:
        return this.advance().value;
      default:
        throw new ParseError(
          `Expected value but got ${token.type} ("${token.value}")`,
          token.line,
          token.column,
        );
    }
  }

  private currentNodeDefaults(): Record<string, string> {
    return this.nodeDefaultsStack[this.nodeDefaultsStack.length - 1]!;
  }

  private currentEdgeDefaults(): Record<string, string> {
    return this.edgeDefaultsStack[this.edgeDefaultsStack.length - 1]!;
  }

  private ensureNode(id: string, explicitAttrs: Record<string, string>): Node {
    let node = this.nodes.get(id);
    if (!node) {
      node = createDefaultNode(id);
      // Apply current scope defaults
      const defaults = this.currentNodeDefaults();
      this.applyNodeAttributes(node, defaults, false);
      this.nodes.set(id, node);
    }

    // Apply explicit attributes
    if (Object.keys(explicitAttrs).length > 0) {
      this.applyNodeAttributes(node, explicitAttrs, true);
    }

    return node;
  }

  private applyNodeAttributes(
    node: Node,
    attrs: Record<string, string>,
    isExplicit: boolean,
  ): void {
    for (const [key, value] of Object.entries(attrs)) {
      node.raw[key] = value;
      if (isExplicit) {
        node.explicitKeys.add(key);
      }

      switch (key) {
        case "label":
          node.label = value;
          break;
        case "shape":
          node.shape = value;
          break;
        case "type":
          node.type = value;
          break;
        case "prompt":
          node.prompt = value;
          break;
        case "max_retries":
          node.maxRetries = parseInteger(value, 0);
          break;
        case "goal_gate":
          node.goalGate = parseBoolean(value, false);
          break;
        case "retry_target":
          node.retryTarget = value;
          break;
        case "fallback_retry_target":
          node.fallbackRetryTarget = value;
          break;
        case "fidelity":
          node.fidelity = value;
          break;
        case "thread_id":
          node.threadId = value;
          break;
        case "class":
          node.className = value;
          break;
        case "timeout": {
          const ms = parseDuration(value);
          node.timeout = ms !== undefined ? ms : parseInteger(value, 0) || undefined;
          break;
        }
        case "llm_model":
          node.llmModel = value;
          break;
        case "llm_provider":
          node.llmProvider = value;
          break;
        case "reasoning_effort":
          node.reasoningEffort = value;
          break;
        case "auto_status":
          node.autoStatus = parseBoolean(value, false);
          break;
        case "allow_partial":
          node.allowPartial = parseBoolean(value, false);
          break;
      }
    }
  }

  private applyGraphAttributes(attrs: Record<string, string>): void {
    for (const [key, value] of Object.entries(attrs)) {
      this.graphAttributes.raw[key] = value;

      switch (key) {
        case "goal":
          this.graphAttributes.goal = value;
          break;
        case "label":
          this.graphAttributes.label = value;
          break;
        case "model_stylesheet":
          this.graphAttributes.modelStylesheet = value;
          break;
        case "default_max_retry":
          this.graphAttributes.defaultMaxRetry = parseInteger(value, 50);
          break;
        case "retry_target":
          this.graphAttributes.retryTarget = value;
          break;
        case "fallback_retry_target":
          this.graphAttributes.fallbackRetryTarget = value;
          break;
        case "default_fidelity":
          this.graphAttributes.defaultFidelity = value;
          break;
      }
    }
  }

  private buildEdge(
    source: string,
    target: string,
    explicitAttrs: Record<string, string>,
  ): Edge {
    const edge = createDefaultEdge(source, target);

    // Apply edge defaults
    const defaults = this.currentEdgeDefaults();
    this.applyEdgeAttributes(edge, defaults);

    // Apply explicit attributes (override defaults)
    this.applyEdgeAttributes(edge, explicitAttrs);

    return edge;
  }

  private applyEdgeAttributes(edge: Edge, attrs: Record<string, string>): void {
    for (const [key, value] of Object.entries(attrs)) {
      edge.raw[key] = value;

      switch (key) {
        case "label":
          edge.label = value;
          break;
        case "condition":
          edge.condition = value;
          break;
        case "weight":
          edge.weight = parseInteger(value, 0);
          break;
        case "fidelity":
          edge.fidelity = value;
          break;
        case "thread_id":
          edge.threadId = value;
          break;
        case "loop_restart":
          edge.loopRestart = parseBoolean(value, false);
          break;
      }
    }
  }
}

/**
 * Derive a CSS-like class name from a subgraph label.
 * Lowercase, replace spaces with hyphens, strip non-alphanumeric (except hyphens).
 */
export function deriveClassName(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

/**
 * Parse a DOT source string into a Graph.
 */
export function parseDot(source: string): Graph {
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  return parser.parse();
}
