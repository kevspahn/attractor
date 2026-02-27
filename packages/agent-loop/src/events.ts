/**
 * Event system for the agent loop.
 *
 * Every agent action emits a typed event. Events are delivered to the host
 * application via the EventEmitter.
 */

/**
 * Discriminator tags for agent events.
 */
export type EventKind =
  | "SESSION_START"
  | "SESSION_END"
  | "USER_INPUT"
  | "ASSISTANT_TEXT_START"
  | "ASSISTANT_TEXT_DELTA"
  | "ASSISTANT_TEXT_END"
  | "TOOL_CALL_START"
  | "TOOL_CALL_OUTPUT_DELTA"
  | "TOOL_CALL_END"
  | "STEERING_INJECTED"
  | "TURN_LIMIT"
  | "LOOP_DETECTION"
  | "ERROR";

/**
 * A single event emitted by the agent loop.
 */
export interface AgentEvent {
  kind: EventKind;
  timestamp: number;
  data?: unknown;
}

type EventHandler = (event: AgentEvent) => void;

/**
 * Simple synchronous event emitter for agent events.
 */
export class EventEmitter {
  private _handlers: Map<EventKind, EventHandler[]> = new Map();
  private _anyHandlers: EventHandler[] = [];

  /**
   * Subscribe to a specific event kind.
   */
  on(kind: EventKind, handler: EventHandler): void {
    let handlers = this._handlers.get(kind);
    if (!handlers) {
      handlers = [];
      this._handlers.set(kind, handlers);
    }
    handlers.push(handler);
  }

  /**
   * Subscribe to all events.
   */
  onAny(handler: EventHandler): void {
    this._anyHandlers.push(handler);
  }

  /**
   * Emit an event to all matching subscribers.
   */
  emit(event: AgentEvent): void {
    // Specific handlers
    const handlers = this._handlers.get(event.kind);
    if (handlers) {
      for (const handler of handlers) {
        handler(event);
      }
    }
    // Any-handlers
    for (const handler of this._anyHandlers) {
      handler(event);
    }
  }

  /**
   * Remove all event listeners.
   */
  removeAllListeners(): void {
    this._handlers.clear();
    this._anyHandlers = [];
  }
}
