/**
 * A worker for the suites: what `markdownSyntax.ts` is handed in place of the
 * one a browser starts, so a suite says what a worker said and when.
 */

import type {
  MarkdownSyntaxAsked,
  MarkdownSyntaxOpen,
} from "../app/browser/ui/markdownSyntax.ts";
import { markdownSyntaxAnswered } from "../app/browser/ui/markdownSyntaxRead.ts";

/** One worker a desk started: what it was asked, whether it was ended, and
 * the way to have it say something. */
export interface SyntaxDoubleWorker {
  readonly asked: MarkdownSyntaxAsked[];
  ended: boolean;
  readonly say: (message: unknown) => void;
}

/** What starts workers, and every worker it started, oldest first. */
export interface SyntaxDouble {
  readonly open: MarkdownSyntaxOpen;
  readonly workers: SyntaxDoubleWorker[];
}

/** Workers that say nothing until a suite has them say it. */
export function syntaxDoubleHeld(): SyntaxDouble {
  const workers: SyntaxDoubleWorker[] = [];
  return {
    workers,
    open: (heard) => {
      const worker: SyntaxDoubleWorker = {
        asked: [],
        ended: false,
        say: heard,
      };
      workers.push(worker);
      return {
        ask: (asked) => {
          worker.asked.push(asked);
        },
        end: () => {
          worker.ended = true;
        },
      };
    },
  };
}

/**
 * Workers that do what the real one does, a turn of the loop later: each says
 * it is ready, and answers what it is asked with the reading the real one
 * makes, copied as a message between threads is.
 */
export function syntaxDoubleReading(): SyntaxDouble {
  const held = syntaxDoubleHeld();
  return {
    workers: held.workers,
    open: (heard) => {
      const worker = held.open(heard);
      const later = (message: unknown): void => {
        setTimeout(() => {
          heard(structuredClone(message));
        }, 0);
      };
      later({ ready: true });
      return {
        ask: (asked) => {
          worker.ask(asked);
          later(markdownSyntaxAnswered(asked));
        },
        end: worker.end,
      };
    },
  };
}
