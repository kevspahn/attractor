import { describe, it, expect } from "vitest";
import {
  parseDuration,
  parseAttributeValue,
  parseInteger,
  parseBoolean,
} from "../../src/parser/values.js";

describe("parseDuration", () => {
  it("parses milliseconds", () => {
    expect(parseDuration("250ms")).toBe(250);
  });

  it("parses seconds", () => {
    expect(parseDuration("900s")).toBe(900_000);
  });

  it("parses minutes", () => {
    expect(parseDuration("15m")).toBe(900_000);
  });

  it("parses hours", () => {
    expect(parseDuration("2h")).toBe(7_200_000);
  });

  it("parses days", () => {
    expect(parseDuration("1d")).toBe(86_400_000);
  });

  it("returns undefined for non-duration strings", () => {
    expect(parseDuration("hello")).toBeUndefined();
    expect(parseDuration("42")).toBeUndefined();
    expect(parseDuration("")).toBeUndefined();
  });

  it("handles whitespace", () => {
    expect(parseDuration("  900s  ")).toBe(900_000);
  });

  it("900s and 15m are equal", () => {
    expect(parseDuration("900s")).toBe(parseDuration("15m"));
  });
});

describe("parseAttributeValue", () => {
  it("parses booleans", () => {
    expect(parseAttributeValue("true")).toBe(true);
    expect(parseAttributeValue("false")).toBe(false);
  });

  it("parses durations as milliseconds", () => {
    expect(parseAttributeValue("900s")).toBe(900_000);
    expect(parseAttributeValue("15m")).toBe(900_000);
  });

  it("parses floats", () => {
    expect(parseAttributeValue("0.5")).toBe(0.5);
    expect(parseAttributeValue("-3.14")).toBe(-3.14);
  });

  it("parses integers", () => {
    expect(parseAttributeValue("42")).toBe(42);
    expect(parseAttributeValue("-1")).toBe(-1);
    expect(parseAttributeValue("0")).toBe(0);
  });

  it("returns strings for non-numeric, non-boolean values", () => {
    expect(parseAttributeValue("hello")).toBe("hello");
    expect(parseAttributeValue("box")).toBe("box");
  });

  it("handles whitespace", () => {
    expect(parseAttributeValue("  42  ")).toBe(42);
    expect(parseAttributeValue("  true  ")).toBe(true);
  });
});

describe("parseInteger", () => {
  it("parses valid integers", () => {
    expect(parseInteger("42")).toBe(42);
    expect(parseInteger("-1")).toBe(-1);
  });

  it("returns default for non-integers", () => {
    expect(parseInteger("abc")).toBe(0);
    expect(parseInteger("abc", 5)).toBe(5);
  });
});

describe("parseBoolean", () => {
  it("parses true and false", () => {
    expect(parseBoolean("true")).toBe(true);
    expect(parseBoolean("false")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(parseBoolean("TRUE")).toBe(true);
    expect(parseBoolean("False")).toBe(false);
  });

  it("returns default for non-booleans", () => {
    expect(parseBoolean("abc")).toBe(false);
    expect(parseBoolean("abc", true)).toBe(true);
  });
});
