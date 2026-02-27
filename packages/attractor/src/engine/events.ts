/**
 * Pipeline observability events.
 *
 * The engine emits typed events during execution for UI, logging,
 * and metrics integration.
 *
 * See spec Section 9.6.
 */

// ---------- Event Types ----------

export interface PipelineStartedEvent {
  type: "PipelineStarted";
  name: string;
  id: string;
  timestamp: string;
}

export interface PipelineCompletedEvent {
  type: "PipelineCompleted";
  duration: number;
  artifactCount: number;
  timestamp: string;
}

export interface PipelineFailedEvent {
  type: "PipelineFailed";
  error: string;
  duration: number;
  timestamp: string;
}

export interface StageStartedEvent {
  type: "StageStarted";
  name: string;
  index: number;
  timestamp: string;
}

export interface StageCompletedEvent {
  type: "StageCompleted";
  name: string;
  index: number;
  duration: number;
  timestamp: string;
}

export interface StageFailedEvent {
  type: "StageFailed";
  name: string;
  index: number;
  error: string;
  willRetry: boolean;
  timestamp: string;
}

export interface StageRetryingEvent {
  type: "StageRetrying";
  name: string;
  index: number;
  attempt: number;
  delay: number;
  timestamp: string;
}

export interface ParallelStartedEvent {
  type: "ParallelStarted";
  branchCount: number;
  timestamp: string;
}

export interface BranchStartedEvent {
  type: "BranchStarted";
  branch: string;
  index: number;
  timestamp: string;
}

export interface BranchCompletedEvent {
  type: "BranchCompleted";
  branch: string;
  index: number;
  duration: number;
  success: boolean;
  timestamp: string;
}

export interface ParallelCompletedEvent {
  type: "ParallelCompleted";
  duration: number;
  successCount: number;
  failureCount: number;
  timestamp: string;
}

export interface InterviewStartedEvent {
  type: "InterviewStarted";
  question: string;
  stage: string;
  timestamp: string;
}

export interface InterviewCompletedEvent {
  type: "InterviewCompleted";
  question: string;
  answer: string;
  duration: number;
  timestamp: string;
}

export interface InterviewTimeoutEvent {
  type: "InterviewTimeout";
  question: string;
  stage: string;
  duration: number;
  timestamp: string;
}

export interface CheckpointSavedEvent {
  type: "CheckpointSaved";
  nodeId: string;
  timestamp: string;
}

export type PipelineEvent =
  | PipelineStartedEvent
  | PipelineCompletedEvent
  | PipelineFailedEvent
  | StageStartedEvent
  | StageCompletedEvent
  | StageFailedEvent
  | StageRetryingEvent
  | ParallelStartedEvent
  | BranchStartedEvent
  | BranchCompletedEvent
  | ParallelCompletedEvent
  | InterviewStartedEvent
  | InterviewCompletedEvent
  | InterviewTimeoutEvent
  | CheckpointSavedEvent;

// ---------- Event Emitter ----------

export type EventListener = (event: PipelineEvent) => void;

export class PipelineEventEmitter {
  private listeners: EventListener[] = [];

  /** Register an event listener. */
  on(listener: EventListener): void {
    this.listeners.push(listener);
  }

  /** Remove an event listener. */
  off(listener: EventListener): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  /** Emit an event to all listeners. */
  emit(event: PipelineEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /** Remove all listeners. */
  clear(): void {
    this.listeners = [];
  }

  /** Helper: create and emit an event with auto-timestamp. */
  emitPipelineStarted(name: string, id: string): void {
    this.emit({
      type: "PipelineStarted",
      name,
      id,
      timestamp: new Date().toISOString(),
    });
  }

  emitPipelineCompleted(duration: number, artifactCount: number): void {
    this.emit({
      type: "PipelineCompleted",
      duration,
      artifactCount,
      timestamp: new Date().toISOString(),
    });
  }

  emitPipelineFailed(error: string, duration: number): void {
    this.emit({
      type: "PipelineFailed",
      error,
      duration,
      timestamp: new Date().toISOString(),
    });
  }

  emitStageStarted(name: string, index: number): void {
    this.emit({
      type: "StageStarted",
      name,
      index,
      timestamp: new Date().toISOString(),
    });
  }

  emitStageCompleted(name: string, index: number, duration: number): void {
    this.emit({
      type: "StageCompleted",
      name,
      index,
      duration,
      timestamp: new Date().toISOString(),
    });
  }

  emitStageFailed(
    name: string,
    index: number,
    error: string,
    willRetry: boolean,
  ): void {
    this.emit({
      type: "StageFailed",
      name,
      index,
      error,
      willRetry,
      timestamp: new Date().toISOString(),
    });
  }

  emitStageRetrying(
    name: string,
    index: number,
    attempt: number,
    delay: number,
  ): void {
    this.emit({
      type: "StageRetrying",
      name,
      index,
      attempt,
      delay,
      timestamp: new Date().toISOString(),
    });
  }

  emitCheckpointSaved(nodeId: string): void {
    this.emit({
      type: "CheckpointSaved",
      nodeId,
      timestamp: new Date().toISOString(),
    });
  }
}
