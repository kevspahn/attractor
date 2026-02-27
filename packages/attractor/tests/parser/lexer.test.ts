import { describe, it, expect } from "vitest";
import { tokenize, TokenType, LexerError } from "../../src/parser/lexer.js";

describe("tokenize", () => {
  it("tokenizes keywords", () => {
    const tokens = tokenize("digraph subgraph node edge graph");
    expect(tokens.map((t) => t.type)).toEqual([
      TokenType.DIGRAPH,
      TokenType.SUBGRAPH,
      TokenType.NODE,
      TokenType.EDGE,
      TokenType.GRAPH,
      TokenType.EOF,
    ]);
  });

  it("tokenizes identifiers", () => {
    const tokens = tokenize("myNode _foo bar123");
    expect(tokens.filter((t) => t.type === TokenType.IDENTIFIER).map((t) => t.value)).toEqual([
      "myNode",
      "_foo",
      "bar123",
    ]);
  });

  it("tokenizes quoted strings with escapes", () => {
    const tokens = tokenize('"hello world" "line1\\nline2" "tab\\there" "escaped\\\\"');
    const strings = tokens.filter((t) => t.type === TokenType.STRING);
    expect(strings.map((t) => t.value)).toEqual([
      "hello world",
      "line1\nline2",
      "tab\there",
      "escaped\\",
    ]);
  });

  it("tokenizes escaped quotes in strings", () => {
    const tokens = tokenize('"say \\"hello\\""');
    expect(tokens[0]!.value).toBe('say "hello"');
  });

  it("tokenizes integers", () => {
    const tokens = tokenize("42 -1 0");
    const ints = tokens.filter((t) => t.type === TokenType.INTEGER);
    expect(ints.map((t) => t.value)).toEqual(["42", "-1", "0"]);
  });

  it("tokenizes floats", () => {
    const tokens = tokenize("0.5 -3.14");
    const floats = tokens.filter((t) => t.type === TokenType.FLOAT);
    expect(floats.map((t) => t.value)).toEqual(["0.5", "-3.14"]);
  });

  it("tokenizes booleans", () => {
    const tokens = tokenize("true false");
    const bools = tokens.filter((t) => t.type === TokenType.BOOLEAN);
    expect(bools.map((t) => t.value)).toEqual(["true", "false"]);
  });

  it("tokenizes operators and punctuation", () => {
    const tokens = tokenize("-> = { } [ ] ; ,");
    expect(tokens.map((t) => t.type)).toEqual([
      TokenType.ARROW,
      TokenType.EQUALS,
      TokenType.LBRACE,
      TokenType.RBRACE,
      TokenType.LBRACKET,
      TokenType.RBRACKET,
      TokenType.SEMICOLON,
      TokenType.COMMA,
      TokenType.EOF,
    ]);
  });

  it("strips line comments", () => {
    const tokens = tokenize("A // this is a comment\nB");
    const ids = tokens.filter((t) => t.type === TokenType.IDENTIFIER);
    expect(ids.map((t) => t.value)).toEqual(["A", "B"]);
  });

  it("strips block comments", () => {
    const tokens = tokenize("A /* multi\nline\ncomment */ B");
    const ids = tokens.filter((t) => t.type === TokenType.IDENTIFIER);
    expect(ids.map((t) => t.value)).toEqual(["A", "B"]);
  });

  it("tokenizes a simple digraph", () => {
    const input = `digraph Test {
      A -> B [label="next"]
    }`;
    const tokens = tokenize(input);
    expect(tokens.map((t) => t.type)).toEqual([
      TokenType.DIGRAPH,
      TokenType.IDENTIFIER,
      TokenType.LBRACE,
      TokenType.IDENTIFIER,
      TokenType.ARROW,
      TokenType.IDENTIFIER,
      TokenType.LBRACKET,
      TokenType.IDENTIFIER,
      TokenType.EQUALS,
      TokenType.STRING,
      TokenType.RBRACKET,
      TokenType.RBRACE,
      TokenType.EOF,
    ]);
  });

  it("tokenizes node with attributes", () => {
    const input = 'start [shape=Mdiamond, label="Start"]';
    const tokens = tokenize(input);
    expect(tokens.map((t) => t.type)).toEqual([
      TokenType.IDENTIFIER,
      TokenType.LBRACKET,
      TokenType.IDENTIFIER,
      TokenType.EQUALS,
      TokenType.IDENTIFIER,
      TokenType.COMMA,
      TokenType.IDENTIFIER,
      TokenType.EQUALS,
      TokenType.STRING,
      TokenType.RBRACKET,
      TokenType.EOF,
    ]);
  });

  it("tokenizes graph attributes", () => {
    const input = 'graph [goal="Build feature"]';
    const tokens = tokenize(input);
    expect(tokens[0]!.type).toBe(TokenType.GRAPH);
    // GRAPH, LBRACKET, IDENTIFIER("goal"), EQUALS, STRING, RBRACKET
    expect(tokens[2]!.type).toBe(TokenType.IDENTIFIER);
    expect(tokens[2]!.value).toBe("goal");
  });

  it("rejects undirected edges", () => {
    expect(() => tokenize("A -- B")).toThrow(LexerError);
    expect(() => tokenize("A -- B")).toThrow("Undirected edges");
  });

  it("throws on unterminated string", () => {
    expect(() => tokenize('"unterminated')).toThrow(LexerError);
    expect(() => tokenize('"unterminated')).toThrow("Unterminated string");
  });

  it("throws on unterminated block comment", () => {
    expect(() => tokenize("/* never closed")).toThrow(LexerError);
    expect(() => tokenize("/* never closed")).toThrow("Unterminated block comment");
  });

  it("throws on unexpected character", () => {
    expect(() => tokenize("@")).toThrow(LexerError);
  });

  it("tracks line and column numbers", () => {
    const tokens = tokenize("A\nB");
    expect(tokens[0]!.line).toBe(1);
    expect(tokens[0]!.column).toBe(1);
    expect(tokens[1]!.line).toBe(2);
    expect(tokens[1]!.column).toBe(1);
  });

  it("handles empty input", () => {
    const tokens = tokenize("");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.type).toBe(TokenType.EOF);
  });

  it("tokenizes chained edges", () => {
    const input = "A -> B -> C";
    const tokens = tokenize(input);
    expect(tokens.map((t) => t.type)).toEqual([
      TokenType.IDENTIFIER,
      TokenType.ARROW,
      TokenType.IDENTIFIER,
      TokenType.ARROW,
      TokenType.IDENTIFIER,
      TokenType.EOF,
    ]);
  });

  it("handles keywords case-insensitively", () => {
    const tokens = tokenize("DIGRAPH DiGraph");
    expect(tokens[0]!.type).toBe(TokenType.DIGRAPH);
    expect(tokens[1]!.type).toBe(TokenType.DIGRAPH);
  });

  it("tokenizes dot-separated attribute keys", () => {
    // Dot-separated keys like stack.child_dotfile appear in DOT attribute blocks
    // The lexer should handle dots within identifier sequences
    const input = 'stack.child_dotfile = "test.dot"';
    const tokens = tokenize(input);
    // stack.child_dotfile is treated as a qualified identifier
    expect(tokens[0]!.type).toBe(TokenType.IDENTIFIER);
    expect(tokens[0]!.value).toBe("stack.child_dotfile");
  });
});
