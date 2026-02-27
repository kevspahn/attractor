# Attractor Implementation Design

## Overview

Implement the Attractor system as a TypeScript monorepo with three packages, built bottom-up:

1. **`packages/llm-client`** — Unified LLM Client SDK
2. **`packages/agent-loop`** — Coding Agent Loop
3. **`packages/attractor`** — DOT Pipeline Engine

## Decisions

- **Language:** TypeScript
- **Providers:** OpenAI, Anthropic, Gemini (all three from the start)
- **Structure:** pnpm monorepo with packages/
- **Tooling:** pnpm workspaces + tsup for builds
- **Testing:** Vitest
- **Approach:** Bottom-up (LLM client → Agent loop → Attractor)
- **Agent tools:** Fully functional (file I/O, shell, search)

## Package 1: Unified LLM Client (`packages/llm-client`)

### Architecture

Four-layer design per spec:

- **Layer 1 (Types)** — `src/types/`: Message, ContentPart, Request, Response, StreamEvent, Usage, ToolDefinition, error hierarchy. TypeScript interfaces with discriminated unions.
- **Layer 2 (Utilities)** — `src/utils/`: SSE parser, HTTP client (native fetch), retry with exponential backoff + jitter, response normalization.
- **Layer 3 (Client)** — `src/client.ts`: Client class with `complete()`/`stream()`, provider registry, middleware chain (onion pattern), `Client.fromEnv()`.
- **Layer 4 (High-Level API)** — `src/generate.ts`, `src/stream.ts`: `generate()`, `stream()`, `generateObject()` with tool loops, retries, structured output.

### Provider Adapters

Each adapter uses the provider's native API:

- **OpenAI** → Responses API (`/v1/responses`). Separate `OpenAICompatibleAdapter` for Chat Completions (third-party endpoints).
- **Anthropic** → Messages API (`/v1/messages`). Auto `cache_control` injection for agentic workloads.
- **Gemini** → Gemini API (`/v1beta/models/*/generateContent`). Synthetic tool call IDs.

### Key Details

- Native `fetch` for HTTP
- `AsyncIterableIterator<StreamEvent>` for streaming
- Full error hierarchy with retryability classification
- Model catalog as data structure with lookup functions
- Anthropic auto-caching on system prompt and tool definitions

## Package 2: Coding Agent Loop (`packages/agent-loop`)

### Components

- **`AgentLoop` class** — Main turn loop: LLM call → tool execution → append results → repeat until task done.
- **Context management** — Token tracking, truncation when approaching limits, keep system prompt + recent turns.
- **Built-in tools** — `file_read`, `file_write`, `file_edit`, `shell_exec`, `glob`, `grep`, `list_directory`.
- **System prompt** — Assembles environment context (OS, cwd, shell, git status).
- **Subagent support** — Spawn child loops for parallel subtasks with isolated context.
- **Loop detection** — Detect repeated actions.

### Integration

Uses `Client.stream()` directly (not high-level `generate()`) because the agent loop manages its own turn loop, tool execution, context truncation, and steering.

## Package 3: Attractor Pipeline Engine (`packages/attractor`)

### Components

- **DOT Parser** — Parses Graphviz DOT syntax into internal graph (nodes, edges, attributes). Supports `digraph`, subgraphs, spec'd attributes (`type`, `prompt`, `model`, `tools`, `condition`).
- **Execution Engine** — Pipeline traversal: topological processing from entry nodes, edge condition evaluation, parallel fan-out with concurrent execution, fan-in joins, observability events.
- **Node Handlers:**
  - `llm` — LLM call via unified client, prompt templates with `{{variable}}` interpolation
  - `coding_agent` — Spawns agent loop for code tasks
  - `human` — Pause for human approval/feedback, interviewer pattern
  - `conditional` — Evaluate condition, route to matching edge
  - `parallel` — Fan-out/fan-in for concurrent subgraphs
- **State Management** — Key-value store flowing through nodes, per-node output keys, subgraph scoping.
- **Validation** — DAG enforcement, attribute validation, model/tool existence checks, condition syntax validation.
- **Model Stylesheet** — Map logical names (`"fast"`, `"quality"`) to model IDs.
- **Condition Language** — Variable references, comparisons, boolean operators, string matching.

## Testing

- **Unit tests** — Vitest, mock HTTP for provider adapters, mock handlers for engine, co-located with source.
- **Integration tests** — Real API calls (guarded by env vars), cross-provider parity matrix, end-to-end pipeline execution.

## File Layout

```
attractor/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vitest.workspace.ts
├── packages/
│   ├── llm-client/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── client.ts
│   │   │   ├── types/
│   │   │   ├── providers/{openai,anthropic,gemini}/
│   │   │   ├── utils/
│   │   │   ├── generate.ts
│   │   │   ├── stream.ts
│   │   │   └── catalog.ts
│   │   └── tests/
│   ├── agent-loop/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── loop.ts
│   │   │   ├── tools/
│   │   │   ├── context.ts
│   │   │   ├── system-prompt.ts
│   │   │   └── subagent.ts
│   │   └── tests/
│   └── attractor/
│       ├── src/
│       │   ├── index.ts
│       │   ├── parser.ts
│       │   ├── engine.ts
│       │   ├── handlers/
│       │   ├── state.ts
│       │   ├── validator.ts
│       │   └── stylesheet.ts
│       └── tests/
```
