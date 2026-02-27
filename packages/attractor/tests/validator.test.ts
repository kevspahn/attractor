import { describe, it, expect } from "vitest";
import {
  validate,
  validateOrRaise,
  ValidationError,
  Severity,
} from "../src/validator.js";
import { parseDot } from "../src/parser/parser.js";
import type { Graph } from "../src/parser/types.js";
import type { LintRule, Diagnostic } from "../src/validator.js";

/** Helper to parse and validate a DOT string */
function parseAndValidate(dot: string): Diagnostic[] {
  const graph = parseDot(dot);
  return validate(graph);
}

/** Helper: valid minimal graph */
const VALID_GRAPH = `
  digraph Test {
    start [shape=Mdiamond]
    exit  [shape=Msquare]
    task  [label="Do work", prompt="Do the work"]
    start -> task -> exit
  }
`;

describe("validate", () => {
  describe("start_node rule", () => {
    it("passes with exactly one start node", () => {
      const diagnostics = parseAndValidate(VALID_GRAPH);
      const startErrors = diagnostics.filter(
        (d) => d.rule === "start_node" && d.severity === Severity.ERROR,
      );
      expect(startErrors).toHaveLength(0);
    });

    it("fails with no start node", () => {
      const diagnostics = parseAndValidate(`
        digraph Test {
          exit [shape=Msquare]
          task [label="Do work"]
          task -> exit
        }
      `);
      const errors = diagnostics.filter((d) => d.rule === "start_node");
      expect(errors).toHaveLength(1);
      expect(errors[0]!.severity).toBe(Severity.ERROR);
    });

    it("fails with multiple start nodes", () => {
      const diagnostics = parseAndValidate(`
        digraph Test {
          s1 [shape=Mdiamond]
          s2 [shape=Mdiamond]
          exit [shape=Msquare]
          s1 -> exit
          s2 -> exit
        }
      `);
      const errors = diagnostics.filter((d) => d.rule === "start_node");
      expect(errors).toHaveLength(1);
      expect(errors[0]!.message).toContain("found 2");
    });
  });

  describe("terminal_node rule", () => {
    it("passes with at least one terminal node", () => {
      const diagnostics = parseAndValidate(VALID_GRAPH);
      const errors = diagnostics.filter(
        (d) => d.rule === "terminal_node" && d.severity === Severity.ERROR,
      );
      expect(errors).toHaveLength(0);
    });

    it("fails with no terminal node", () => {
      const diagnostics = parseAndValidate(`
        digraph Test {
          start [shape=Mdiamond]
          task  [label="Do work"]
          start -> task
        }
      `);
      const errors = diagnostics.filter((d) => d.rule === "terminal_node");
      expect(errors).toHaveLength(1);
      expect(errors[0]!.severity).toBe(Severity.ERROR);
    });
  });

  describe("reachability rule", () => {
    it("passes when all nodes are reachable", () => {
      const diagnostics = parseAndValidate(VALID_GRAPH);
      const errors = diagnostics.filter(
        (d) => d.rule === "reachability" && d.severity === Severity.ERROR,
      );
      expect(errors).toHaveLength(0);
    });

    it("fails with an unreachable node", () => {
      const diagnostics = parseAndValidate(`
        digraph Test {
          start  [shape=Mdiamond]
          exit   [shape=Msquare]
          orphan [label="Orphan"]
          start -> exit
        }
      `);
      const errors = diagnostics.filter((d) => d.rule === "reachability");
      expect(errors).toHaveLength(1);
      expect(errors[0]!.nodeId).toBe("orphan");
    });
  });

  describe("edge_target_exists rule", () => {
    it("passes when all edge targets exist", () => {
      const diagnostics = parseAndValidate(VALID_GRAPH);
      const errors = diagnostics.filter(
        (d) => d.rule === "edge_target_exists" && d.severity === Severity.ERROR,
      );
      expect(errors).toHaveLength(0);
    });

    // NOTE: In our parser, edges auto-create nodes, so this rule
    // typically only fires if the graph was constructed programmatically
    // with missing nodes.
  });

  describe("start_no_incoming rule", () => {
    it("passes when start has no incoming edges", () => {
      const diagnostics = parseAndValidate(VALID_GRAPH);
      const errors = diagnostics.filter(
        (d) => d.rule === "start_no_incoming" && d.severity === Severity.ERROR,
      );
      expect(errors).toHaveLength(0);
    });

    it("fails when start has incoming edges", () => {
      const diagnostics = parseAndValidate(`
        digraph Test {
          start [shape=Mdiamond]
          exit  [shape=Msquare]
          task  [label="Task"]
          start -> task -> exit
          task -> start
        }
      `);
      const errors = diagnostics.filter((d) => d.rule === "start_no_incoming");
      expect(errors).toHaveLength(1);
    });
  });

  describe("exit_no_outgoing rule", () => {
    it("passes when exit has no outgoing edges", () => {
      const diagnostics = parseAndValidate(VALID_GRAPH);
      const errors = diagnostics.filter(
        (d) => d.rule === "exit_no_outgoing" && d.severity === Severity.ERROR,
      );
      expect(errors).toHaveLength(0);
    });

    it("fails when exit has outgoing edges", () => {
      const diagnostics = parseAndValidate(`
        digraph Test {
          start [shape=Mdiamond]
          exit  [shape=Msquare]
          task  [label="Task"]
          start -> task -> exit
          exit -> task
        }
      `);
      const errors = diagnostics.filter((d) => d.rule === "exit_no_outgoing");
      expect(errors).toHaveLength(1);
    });
  });

  describe("condition_syntax rule", () => {
    it("passes with valid conditions", () => {
      const diagnostics = parseAndValidate(`
        digraph Test {
          start [shape=Mdiamond]
          exit  [shape=Msquare]
          task  [label="Task", prompt="Do it"]
          start -> task
          task -> exit [condition="outcome=success"]
        }
      `);
      const errors = diagnostics.filter(
        (d) => d.rule === "condition_syntax" && d.severity === Severity.ERROR,
      );
      expect(errors).toHaveLength(0);
    });

    it("fails with invalid condition syntax", () => {
      const diagnostics = parseAndValidate(`
        digraph Test {
          start [shape=Mdiamond]
          exit  [shape=Msquare]
          task  [label="Task", prompt="Do it"]
          start -> task
          task -> exit [condition="=broken"]
        }
      `);
      const errors = diagnostics.filter((d) => d.rule === "condition_syntax");
      expect(errors).toHaveLength(1);
      expect(errors[0]!.severity).toBe(Severity.ERROR);
    });
  });

  describe("stylesheet_syntax rule", () => {
    it("passes with valid stylesheet", () => {
      const diagnostics = parseAndValidate(`
        digraph Test {
          graph [model_stylesheet="* { llm_model: claude-sonnet-4-5; }"]
          start [shape=Mdiamond]
          exit  [shape=Msquare]
          start -> exit
        }
      `);
      const errors = diagnostics.filter(
        (d) => d.rule === "stylesheet_syntax" && d.severity === Severity.ERROR,
      );
      expect(errors).toHaveLength(0);
    });

    it("fails with invalid stylesheet", () => {
      const diagnostics = parseAndValidate(`
        digraph Test {
          graph [model_stylesheet="@ broken { }"]
          start [shape=Mdiamond]
          exit  [shape=Msquare]
          start -> exit
        }
      `);
      const errors = diagnostics.filter((d) => d.rule === "stylesheet_syntax");
      expect(errors).toHaveLength(1);
      expect(errors[0]!.severity).toBe(Severity.ERROR);
    });
  });

  describe("type_known rule", () => {
    it("passes with known types", () => {
      const diagnostics = parseAndValidate(`
        digraph Test {
          start [shape=Mdiamond]
          exit  [shape=Msquare]
          task  [type="codergen", prompt="Do it"]
          start -> task -> exit
        }
      `);
      const warnings = diagnostics.filter((d) => d.rule === "type_known");
      expect(warnings).toHaveLength(0);
    });

    it("warns on unknown types", () => {
      const diagnostics = parseAndValidate(`
        digraph Test {
          start [shape=Mdiamond]
          exit  [shape=Msquare]
          task  [type="unknown_type", prompt="Do it"]
          start -> task -> exit
        }
      `);
      const warnings = diagnostics.filter((d) => d.rule === "type_known");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.severity).toBe(Severity.WARNING);
    });
  });

  describe("fidelity_valid rule", () => {
    it("passes with valid fidelity modes", () => {
      const diagnostics = parseAndValidate(`
        digraph Test {
          start [shape=Mdiamond]
          exit  [shape=Msquare]
          task  [fidelity="full", prompt="Do it"]
          start -> task -> exit
        }
      `);
      const warnings = diagnostics.filter((d) => d.rule === "fidelity_valid");
      expect(warnings).toHaveLength(0);
    });

    it("warns on invalid fidelity modes", () => {
      const diagnostics = parseAndValidate(`
        digraph Test {
          start [shape=Mdiamond]
          exit  [shape=Msquare]
          task  [fidelity="invalid_mode", prompt="Do it"]
          start -> task -> exit
        }
      `);
      const warnings = diagnostics.filter((d) => d.rule === "fidelity_valid");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.severity).toBe(Severity.WARNING);
    });
  });

  describe("retry_target_exists rule", () => {
    it("passes when retry target exists", () => {
      const diagnostics = parseAndValidate(`
        digraph Test {
          start [shape=Mdiamond]
          exit  [shape=Msquare]
          task  [retry_target="start", prompt="Do it"]
          start -> task -> exit
        }
      `);
      const warnings = diagnostics.filter((d) => d.rule === "retry_target_exists");
      expect(warnings).toHaveLength(0);
    });

    it("warns when retry target does not exist", () => {
      const diagnostics = parseAndValidate(`
        digraph Test {
          start [shape=Mdiamond]
          exit  [shape=Msquare]
          task  [retry_target="nonexistent", prompt="Do it"]
          start -> task -> exit
        }
      `);
      const warnings = diagnostics.filter((d) => d.rule === "retry_target_exists");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.severity).toBe(Severity.WARNING);
    });
  });

  describe("goal_gate_has_retry rule", () => {
    it("passes when goal gate has retry target", () => {
      const diagnostics = parseAndValidate(`
        digraph Test {
          start [shape=Mdiamond]
          exit  [shape=Msquare]
          task  [goal_gate=true, retry_target="start", prompt="Do it"]
          start -> task -> exit
        }
      `);
      const warnings = diagnostics.filter((d) => d.rule === "goal_gate_has_retry");
      expect(warnings).toHaveLength(0);
    });

    it("warns when goal gate has no retry target", () => {
      const diagnostics = parseAndValidate(`
        digraph Test {
          start [shape=Mdiamond]
          exit  [shape=Msquare]
          task  [goal_gate=true, prompt="Do it"]
          start -> task -> exit
        }
      `);
      const warnings = diagnostics.filter((d) => d.rule === "goal_gate_has_retry");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.severity).toBe(Severity.WARNING);
    });

    it("passes when goal gate has graph-level retry target", () => {
      const diagnostics = parseAndValidate(`
        digraph Test {
          graph [retry_target="start"]
          start [shape=Mdiamond]
          exit  [shape=Msquare]
          task  [goal_gate=true, prompt="Do it"]
          start -> task -> exit
        }
      `);
      const warnings = diagnostics.filter((d) => d.rule === "goal_gate_has_retry");
      expect(warnings).toHaveLength(0);
    });
  });

  describe("prompt_on_llm_nodes rule", () => {
    it("passes when LLM nodes have prompt", () => {
      const diagnostics = parseAndValidate(VALID_GRAPH);
      const warnings = diagnostics.filter((d) => d.rule === "prompt_on_llm_nodes");
      expect(warnings).toHaveLength(0);
    });

    it("warns when LLM node has no prompt or label", () => {
      const diagnostics = parseAndValidate(`
        digraph Test {
          start [shape=Mdiamond]
          exit  [shape=Msquare]
          bare_node
          start -> bare_node -> exit
        }
      `);
      const warnings = diagnostics.filter((d) => d.rule === "prompt_on_llm_nodes");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.nodeId).toBe("bare_node");
    });

    it("passes when LLM node has label but no prompt", () => {
      const diagnostics = parseAndValidate(`
        digraph Test {
          start [shape=Mdiamond]
          exit  [shape=Msquare]
          task  [label="Run tests"]
          start -> task -> exit
        }
      `);
      const warnings = diagnostics.filter((d) => d.rule === "prompt_on_llm_nodes");
      expect(warnings).toHaveLength(0);
    });
  });
});

describe("validateOrRaise", () => {
  it("returns warnings for a valid graph", () => {
    const graph = parseDot(VALID_GRAPH);
    const diagnostics = validateOrRaise(graph);
    const errors = diagnostics.filter((d) => d.severity === Severity.ERROR);
    expect(errors).toHaveLength(0);
  });

  it("throws ValidationError for invalid graph", () => {
    const graph = parseDot(`
      digraph Test {
        task [label="orphan"]
      }
    `);
    expect(() => validateOrRaise(graph)).toThrow(ValidationError);
  });

  it("thrown error contains diagnostics", () => {
    const graph = parseDot(`
      digraph Test {
        task [label="no start or exit"]
      }
    `);
    try {
      validateOrRaise(graph);
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const ve = err as ValidationError;
      expect(ve.diagnostics.length).toBeGreaterThan(0);
      expect(ve.diagnostics.every((d) => d.severity === Severity.ERROR)).toBe(true);
    }
  });
});

describe("custom lint rules", () => {
  it("supports extra rules", () => {
    const customRule: LintRule = {
      name: "custom_rule",
      apply(graph: Graph): Diagnostic[] {
        if (!graph.attributes.goal) {
          return [
            {
              rule: "custom_rule",
              severity: Severity.WARNING,
              message: "Graph should have a goal attribute",
            },
          ];
        }
        return [];
      },
    };

    const graph = parseDot(VALID_GRAPH);
    const diagnostics = validate(graph, [customRule]);
    const custom = diagnostics.filter((d) => d.rule === "custom_rule");
    expect(custom).toHaveLength(1);
  });
});

describe("validates the spec example pipeline", () => {
  it("validates the branching workflow", () => {
    const graph = parseDot(`
      digraph Branch {
        graph [goal="Implement and validate a feature"]
        rankdir=LR
        node [shape=box, timeout="900s"]

        start     [shape=Mdiamond, label="Start"]
        exit      [shape=Msquare, label="Exit"]
        plan      [label="Plan", prompt="Plan the implementation"]
        implement [label="Implement", prompt="Implement the plan"]
        validate  [label="Validate", prompt="Run tests"]
        gate      [shape=diamond, label="Tests passing?"]

        start -> plan -> implement -> validate -> gate
        gate -> exit      [label="Yes", condition="outcome=success"]
        gate -> implement [label="No", condition="outcome!=success"]
      }
    `);
    const diagnostics = validateOrRaise(graph);
    const errors = diagnostics.filter((d) => d.severity === Severity.ERROR);
    expect(errors).toHaveLength(0);
  });
});
