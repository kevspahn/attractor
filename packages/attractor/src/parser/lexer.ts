/**
 * DOT language lexer/tokenizer.
 *
 * Tokenizes a strict DOT subset used by Attractor:
 * - Keywords: digraph, subgraph, node, edge, graph
 * - Identifiers (bare and quoted)
 * - Operators: ->, =, {, }, [, ], ;, ,
 * - Quoted strings with escape sequences
 * - Comments: // line, block comments
 * - Numbers (integer, float), booleans
 */

export const TokenType = {
  // Keywords
  DIGRAPH: "DIGRAPH",
  SUBGRAPH: "SUBGRAPH",
  NODE: "NODE",
  EDGE: "EDGE",
  GRAPH: "GRAPH",

  // Literals
  IDENTIFIER: "IDENTIFIER",
  STRING: "STRING",
  INTEGER: "INTEGER",
  FLOAT: "FLOAT",
  BOOLEAN: "BOOLEAN",

  // Operators / Punctuation
  ARROW: "ARROW", // ->
  EQUALS: "EQUALS", // =
  LBRACE: "LBRACE", // {
  RBRACE: "RBRACE", // }
  LBRACKET: "LBRACKET", // [
  RBRACKET: "RBRACKET", // ]
  SEMICOLON: "SEMICOLON", // ;
  COMMA: "COMMA", // ,

  // Special
  EOF: "EOF",
} as const;

export type TokenType = (typeof TokenType)[keyof typeof TokenType];

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

const KEYWORDS: Record<string, TokenType> = {
  digraph: TokenType.DIGRAPH,
  subgraph: TokenType.SUBGRAPH,
  node: TokenType.NODE,
  edge: TokenType.EDGE,
  graph: TokenType.GRAPH,
  true: TokenType.BOOLEAN,
  false: TokenType.BOOLEAN,
};

export class LexerError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly column: number,
  ) {
    super(`Lexer error at ${line}:${column}: ${message}`);
    this.name = "LexerError";
  }
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let column = 1;

  function peek(): string {
    return pos < input.length ? input[pos]! : "";
  }

  function peekAt(offset: number): string {
    const idx = pos + offset;
    return idx < input.length ? input[idx]! : "";
  }

  function advance(): string {
    const ch = input[pos]!;
    pos++;
    if (ch === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
    return ch;
  }

  function skipWhitespace(): void {
    while (pos < input.length && /\s/.test(input[pos]!)) {
      advance();
    }
  }

  function skipLineComment(): void {
    // consume //
    advance();
    advance();
    while (pos < input.length && input[pos] !== "\n") {
      advance();
    }
  }

  function skipBlockComment(): void {
    const startLine = line;
    const startCol = column;
    // consume /*
    advance();
    advance();
    while (pos < input.length) {
      if (input[pos] === "*" && peekAt(1) === "/") {
        advance();
        advance();
        return;
      }
      advance();
    }
    throw new LexerError("Unterminated block comment", startLine, startCol);
  }

  function readString(): Token {
    const startLine = line;
    const startCol = column;
    advance(); // consume opening "
    let value = "";

    while (pos < input.length) {
      const ch = input[pos]!;
      if (ch === "\\") {
        advance();
        if (pos >= input.length) {
          throw new LexerError(
            "Unterminated string escape",
            startLine,
            startCol,
          );
        }
        const escaped = input[pos]!;
        switch (escaped) {
          case '"':
            value += '"';
            break;
          case "n":
            value += "\n";
            break;
          case "t":
            value += "\t";
            break;
          case "\\":
            value += "\\";
            break;
          default:
            value += "\\" + escaped;
            break;
        }
        advance();
      } else if (ch === '"') {
        advance(); // consume closing "
        return { type: TokenType.STRING, value, line: startLine, column: startCol };
      } else {
        value += ch;
        advance();
      }
    }

    throw new LexerError("Unterminated string", startLine, startCol);
  }

  function readNumber(): Token {
    const startLine = line;
    const startCol = column;
    let value = "";
    let isFloat = false;

    if (peek() === "-") {
      value += advance();
    }

    while (pos < input.length && /[0-9]/.test(input[pos]!)) {
      value += advance();
    }

    if (pos < input.length && input[pos] === "." && /[0-9]/.test(peekAt(1))) {
      isFloat = true;
      value += advance(); // .
      while (pos < input.length && /[0-9]/.test(input[pos]!)) {
        value += advance();
      }
    }

    return {
      type: isFloat ? TokenType.FLOAT : TokenType.INTEGER,
      value,
      line: startLine,
      column: startCol,
    };
  }

  function readIdentifierOrKeyword(): Token {
    const startLine = line;
    const startCol = column;
    let value = "";

    while (pos < input.length && /[A-Za-z0-9_]/.test(input[pos]!)) {
      value += advance();
      // Handle dot-separated qualified identifiers (e.g., stack.child_dotfile)
      if (pos < input.length && input[pos] === "." && /[A-Za-z_]/.test(peekAt(1))) {
        value += advance(); // consume the dot
      }
    }

    const kwType = KEYWORDS[value.toLowerCase()];
    if (kwType !== undefined) {
      // For booleans, preserve exact casing. For keywords, use lowercase.
      if (kwType === TokenType.BOOLEAN) {
        return {
          type: TokenType.BOOLEAN,
          value: value.toLowerCase(),
          line: startLine,
          column: startCol,
        };
      }
      return { type: kwType, value: value.toLowerCase(), line: startLine, column: startCol };
    }

    return {
      type: TokenType.IDENTIFIER,
      value,
      line: startLine,
      column: startCol,
    };
  }

  while (pos < input.length) {
    skipWhitespace();
    if (pos >= input.length) break;

    const startLine = line;
    const startCol = column;
    const ch = peek();

    // Comments
    if (ch === "/" && peekAt(1) === "/") {
      skipLineComment();
      continue;
    }
    if (ch === "/" && peekAt(1) === "*") {
      skipBlockComment();
      continue;
    }

    // String
    if (ch === '"') {
      tokens.push(readString());
      continue;
    }

    // Number (starts with digit or negative sign followed by digit)
    if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(peekAt(1)))) {
      tokens.push(readNumber());
      continue;
    }

    // Identifier or keyword (starts with letter or underscore)
    if (/[A-Za-z_]/.test(ch)) {
      tokens.push(readIdentifierOrKeyword());
      continue;
    }

    // Arrow operator
    if (ch === "-" && peekAt(1) === ">") {
      advance();
      advance();
      tokens.push({ type: TokenType.ARROW, value: "->", line: startLine, column: startCol });
      continue;
    }

    // Undirected edge operator (rejected)
    if (ch === "-" && peekAt(1) === "-") {
      throw new LexerError(
        "Undirected edges (--) are not supported; use directed edges (->)",
        startLine,
        startCol,
      );
    }

    // Single-character operators
    switch (ch) {
      case "=":
        advance();
        tokens.push({ type: TokenType.EQUALS, value: "=", line: startLine, column: startCol });
        continue;
      case "{":
        advance();
        tokens.push({ type: TokenType.LBRACE, value: "{", line: startLine, column: startCol });
        continue;
      case "}":
        advance();
        tokens.push({ type: TokenType.RBRACE, value: "}", line: startLine, column: startCol });
        continue;
      case "[":
        advance();
        tokens.push({
          type: TokenType.LBRACKET,
          value: "[",
          line: startLine,
          column: startCol,
        });
        continue;
      case "]":
        advance();
        tokens.push({
          type: TokenType.RBRACKET,
          value: "]",
          line: startLine,
          column: startCol,
        });
        continue;
      case ";":
        advance();
        tokens.push({
          type: TokenType.SEMICOLON,
          value: ";",
          line: startLine,
          column: startCol,
        });
        continue;
      case ",":
        advance();
        tokens.push({ type: TokenType.COMMA, value: ",", line: startLine, column: startCol });
        continue;
      default:
        throw new LexerError(`Unexpected character: ${ch}`, startLine, startCol);
    }
  }

  tokens.push({ type: TokenType.EOF, value: "", line, column });
  return tokens;
}
