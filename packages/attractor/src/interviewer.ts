/**
 * Interviewer interfaces and built-in implementations.
 *
 * All human interaction in Attractor goes through an Interviewer interface.
 * See spec Section 6.
 */

// ---------- Data Models ----------

export const QuestionType = {
  YES_NO: "yes_no",
  MULTIPLE_CHOICE: "multiple_choice",
  FREEFORM: "freeform",
  CONFIRMATION: "confirmation",
} as const;

export type QuestionType = (typeof QuestionType)[keyof typeof QuestionType];

export const AnswerValue = {
  YES: "yes",
  NO: "no",
  SKIPPED: "skipped",
  TIMEOUT: "timeout",
} as const;

export type AnswerValue = (typeof AnswerValue)[keyof typeof AnswerValue];

export interface Option {
  key: string;
  label: string;
}

export interface Question {
  text: string;
  type: QuestionType;
  options?: Option[];
  default?: Answer;
  timeoutSeconds?: number;
  stage: string;
  metadata?: Record<string, unknown>;
}

export interface Answer {
  value: string;
  selectedOption?: Option;
  text?: string;
}

// ---------- Interviewer Interface ----------

export interface Interviewer {
  ask(question: Question): Promise<Answer>;
  askMultiple?(questions: Question[]): Promise<Answer[]>;
  inform?(message: string, stage: string): Promise<void>;
}

// ---------- Built-in Implementations ----------

/**
 * AutoApproveInterviewer — always YES / first option.
 * Used for automated testing and CI/CD pipelines.
 */
export class AutoApproveInterviewer implements Interviewer {
  async ask(question: Question): Promise<Answer> {
    if (
      question.type === QuestionType.YES_NO ||
      question.type === QuestionType.CONFIRMATION
    ) {
      return { value: AnswerValue.YES };
    }
    if (
      question.type === QuestionType.MULTIPLE_CHOICE &&
      question.options &&
      question.options.length > 0
    ) {
      return {
        value: question.options[0]!.key,
        selectedOption: question.options[0],
      };
    }
    return { value: "auto-approved", text: "auto-approved" };
  }

  async inform(): Promise<void> {
    // No-op for auto-approve
  }
}

/**
 * ConsoleInterviewer — readline-based CLI prompts.
 */
export class ConsoleInterviewer implements Interviewer {
  async ask(question: Question): Promise<Answer> {
    const readline = await import("node:readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise<Answer>((resolve) => {
      const lines: string[] = [`[?] ${question.text}`];

      if (
        question.type === QuestionType.MULTIPLE_CHOICE &&
        question.options
      ) {
        for (const option of question.options) {
          lines.push(`  [${option.key}] ${option.label}`);
        }
      }

      const promptText =
        question.type === QuestionType.YES_NO
          ? "[Y/N]: "
          : question.type === QuestionType.FREEFORM
            ? "> "
            : "Select: ";

      rl.question(`${lines.join("\n")}\n${promptText}`, (response) => {
        rl.close();

        if (question.type === QuestionType.YES_NO) {
          const isYes = response.trim().toLowerCase().startsWith("y");
          resolve({ value: isYes ? AnswerValue.YES : AnswerValue.NO });
          return;
        }

        if (question.type === QuestionType.FREEFORM) {
          resolve({ value: response.trim(), text: response.trim() });
          return;
        }

        if (
          question.type === QuestionType.MULTIPLE_CHOICE &&
          question.options
        ) {
          const trimmed = response.trim().toUpperCase();
          const match = question.options.find(
            (o) => o.key.toUpperCase() === trimmed,
          );
          if (match) {
            resolve({ value: match.key, selectedOption: match });
          } else {
            // Fallback to first option
            resolve({
              value: question.options[0]!.key,
              selectedOption: question.options[0],
            });
          }
          return;
        }

        resolve({ value: response.trim() });
      });
    });
  }

  async inform(message: string, stage: string): Promise<void> {
    console.log(`[${stage}] ${message}`);
  }
}

/**
 * CallbackInterviewer — delegate to a provided function.
 */
export class CallbackInterviewer implements Interviewer {
  constructor(private callback: (question: Question) => Promise<Answer>) {}

  async ask(question: Question): Promise<Answer> {
    return this.callback(question);
  }

  async inform(): Promise<void> {
    // No-op by default
  }
}

/**
 * QueueInterviewer — pre-filled answer queue for deterministic testing.
 */
export class QueueInterviewer implements Interviewer {
  private answers: Answer[];

  constructor(answers: Answer[]) {
    this.answers = [...answers];
  }

  async ask(): Promise<Answer> {
    if (this.answers.length > 0) {
      return this.answers.shift()!;
    }
    return { value: AnswerValue.SKIPPED };
  }

  async inform(): Promise<void> {
    // No-op
  }

  /** Number of remaining answers in the queue. */
  get remaining(): number {
    return this.answers.length;
  }
}
