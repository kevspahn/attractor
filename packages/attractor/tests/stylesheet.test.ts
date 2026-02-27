import { describe, it, expect } from "vitest";
import {
  parseStylesheet,
  applyStylesheet,
  validateStylesheetSyntax,
  StylesheetParseError,
} from "../src/stylesheet.js";
import { parseDot } from "../src/parser/parser.js";
import { createDefaultNode } from "../src/parser/types.js";
import type { Graph, Node } from "../src/parser/types.js";

function makeGraph(nodes: Node[]): Graph {
  const nodeMap = new Map<string, Node>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }
  return {
    id: "test",
    attributes: {
      goal: "",
      label: "",
      modelStylesheet: "",
      defaultMaxRetry: 50,
      retryTarget: "",
      fallbackRetryTarget: "",
      defaultFidelity: "",
      raw: {},
    },
    nodes: nodeMap,
    edges: [],
    subgraphs: [],
  };
}

function makeNode(id: string, overrides: Partial<Node> = {}): Node {
  return { ...createDefaultNode(id), ...overrides };
}

describe("parseStylesheet", () => {
  it("parses universal selector", () => {
    const rules = parseStylesheet('* { llm_model: claude-sonnet-4-5; }');
    expect(rules).toHaveLength(1);
    expect(rules[0]!.selector.type).toBe("universal");
    expect(rules[0]!.selector.specificity).toBe(0);
    expect(rules[0]!.declarations).toHaveLength(1);
    expect(rules[0]!.declarations[0]!.property).toBe("llm_model");
    expect(rules[0]!.declarations[0]!.value).toBe("claude-sonnet-4-5");
  });

  it("parses class selector", () => {
    const rules = parseStylesheet('.fast { llm_model: gemini-3-flash-preview; }');
    expect(rules).toHaveLength(1);
    expect(rules[0]!.selector.type).toBe("class");
    expect(rules[0]!.selector.value).toBe("fast");
    expect(rules[0]!.selector.specificity).toBe(1);
  });

  it("parses ID selector", () => {
    const rules = parseStylesheet('#review { reasoning_effort: high; }');
    expect(rules).toHaveLength(1);
    expect(rules[0]!.selector.type).toBe("id");
    expect(rules[0]!.selector.value).toBe("review");
    expect(rules[0]!.selector.specificity).toBe(2);
  });

  it("parses multiple rules", () => {
    const rules = parseStylesheet(`
      * { llm_model: claude-sonnet-4-5; llm_provider: anthropic; }
      .code { llm_model: claude-opus-4-6; }
      #critical { reasoning_effort: high; }
    `);
    expect(rules).toHaveLength(3);
    expect(rules[0]!.declarations).toHaveLength(2);
    expect(rules[1]!.selector.value).toBe("code");
    expect(rules[2]!.selector.value).toBe("critical");
  });

  it("parses multiple declarations", () => {
    const rules = parseStylesheet(
      '* { llm_model: claude-sonnet-4-5; llm_provider: anthropic; reasoning_effort: medium; }',
    );
    expect(rules[0]!.declarations).toHaveLength(3);
    expect(rules[0]!.declarations.map((d) => d.property)).toEqual([
      "llm_model",
      "llm_provider",
      "reasoning_effort",
    ]);
  });

  it("handles empty stylesheet", () => {
    expect(parseStylesheet("")).toEqual([]);
    expect(parseStylesheet("  ")).toEqual([]);
  });

  it("throws on invalid selector", () => {
    expect(() => parseStylesheet("@ { llm_model: x; }")).toThrow(StylesheetParseError);
  });

  it("throws on missing opening brace", () => {
    expect(() => parseStylesheet("* llm_model: x; }")).toThrow(StylesheetParseError);
  });

  it("throws on unterminated block", () => {
    expect(() => parseStylesheet("* { llm_model: x;")).toThrow(StylesheetParseError);
  });
});

describe("applyStylesheet", () => {
  it("applies universal selector to all nodes", () => {
    const node1 = makeNode("plan");
    const node2 = makeNode("implement");
    const graph = makeGraph([node1, node2]);

    const rules = parseStylesheet('* { llm_model: claude-sonnet-4-5; }');
    applyStylesheet(graph, rules);

    expect(graph.nodes.get("plan")!.llmModel).toBe("claude-sonnet-4-5");
    expect(graph.nodes.get("implement")!.llmModel).toBe("claude-sonnet-4-5");
  });

  it("applies class selector to matching nodes", () => {
    const node1 = makeNode("plan", { className: "code" });
    const node2 = makeNode("review");
    const graph = makeGraph([node1, node2]);

    const rules = parseStylesheet('.code { llm_model: claude-opus-4-6; }');
    applyStylesheet(graph, rules);

    expect(graph.nodes.get("plan")!.llmModel).toBe("claude-opus-4-6");
    expect(graph.nodes.get("review")!.llmModel).toBe(""); // no match
  });

  it("applies ID selector to specific node", () => {
    const node1 = makeNode("plan");
    const node2 = makeNode("review");
    const graph = makeGraph([node1, node2]);

    const rules = parseStylesheet('#review { reasoning_effort: low; }');
    applyStylesheet(graph, rules);

    expect(graph.nodes.get("review")!.reasoningEffort).toBe("low");
    expect(graph.nodes.get("plan")!.reasoningEffort).toBe("high"); // default
  });

  it("higher specificity overrides lower", () => {
    const node = makeNode("review", { className: "code" });
    const graph = makeGraph([node]);

    const rules = parseStylesheet(`
      * { llm_model: claude-sonnet-4-5; }
      .code { llm_model: claude-opus-4-6; }
      #review { llm_model: gpt-5; }
    `);
    applyStylesheet(graph, rules);

    // ID selector has highest specificity
    expect(graph.nodes.get("review")!.llmModel).toBe("gpt-5");
  });

  it("later rules of equal specificity override earlier", () => {
    const node = makeNode("plan");
    const graph = makeGraph([node]);

    const rules = parseStylesheet(`
      * { llm_model: model-a; }
      * { llm_model: model-b; }
    `);
    applyStylesheet(graph, rules);

    expect(graph.nodes.get("plan")!.llmModel).toBe("model-b");
  });

  it("explicit node attributes override stylesheet", () => {
    const node = makeNode("plan");
    node.llmModel = "explicit-model";
    node.explicitKeys.add("llm_model");
    const graph = makeGraph([node]);

    const rules = parseStylesheet('* { llm_model: stylesheet-model; }');
    applyStylesheet(graph, rules);

    expect(graph.nodes.get("plan")!.llmModel).toBe("explicit-model");
  });

  it("applies multiple properties from one rule", () => {
    const node = makeNode("plan");
    const graph = makeGraph([node]);

    const rules = parseStylesheet(
      '* { llm_model: claude-sonnet-4-5; llm_provider: anthropic; reasoning_effort: medium; }',
    );
    applyStylesheet(graph, rules);

    expect(graph.nodes.get("plan")!.llmModel).toBe("claude-sonnet-4-5");
    expect(graph.nodes.get("plan")!.llmProvider).toBe("anthropic");
    expect(graph.nodes.get("plan")!.reasoningEffort).toBe("medium");
  });

  it("handles the spec example correctly", () => {
    const graph = parseDot(`
      digraph Pipeline {
        graph [
          goal="Implement feature X",
          model_stylesheet="* { llm_model: claude-sonnet-4-5; llm_provider: anthropic; } .code { llm_model: claude-opus-4-6; llm_provider: anthropic; } #critical_review { llm_model: gpt-5; llm_provider: openai; reasoning_effort: high; }"
        ]
        start [shape=Mdiamond]
        exit  [shape=Msquare]
        plan            [label="Plan", class="planning"]
        implement       [label="Implement", class="code"]
        critical_review [label="Critical Review", class="code"]
        start -> plan -> implement -> critical_review -> exit
      }
    `);

    const rules = parseStylesheet(graph.attributes.modelStylesheet);
    applyStylesheet(graph, rules);

    // plan gets claude-sonnet-4-5 from * (no .code match)
    expect(graph.nodes.get("plan")!.llmModel).toBe("claude-sonnet-4-5");
    // implement gets claude-opus-4-6 from .code
    expect(graph.nodes.get("implement")!.llmModel).toBe("claude-opus-4-6");
    // critical_review gets gpt-5 from #critical_review (highest specificity)
    expect(graph.nodes.get("critical_review")!.llmModel).toBe("gpt-5");
    expect(graph.nodes.get("critical_review")!.llmProvider).toBe("openai");
  });

  it("handles comma-separated class matching", () => {
    const node = makeNode("review", { className: "code,critical" });
    const graph = makeGraph([node]);

    const rules = parseStylesheet('.critical { reasoning_effort: high; }');
    applyStylesheet(graph, rules);

    expect(graph.nodes.get("review")!.reasoningEffort).toBe("high");
  });
});

describe("validateStylesheetSyntax", () => {
  it("returns null for valid stylesheets", () => {
    expect(validateStylesheetSyntax("")).toBeNull();
    expect(validateStylesheetSyntax('* { llm_model: x; }')).toBeNull();
    expect(validateStylesheetSyntax('.code { llm_model: x; }')).toBeNull();
    expect(validateStylesheetSyntax('#id { reasoning_effort: high; }')).toBeNull();
  });

  it("returns error message for invalid stylesheets", () => {
    expect(validateStylesheetSyntax("@ { x: y; }")).toBeTruthy();
    expect(validateStylesheetSyntax("* { x: ; }")).toBeTruthy();
  });
});
