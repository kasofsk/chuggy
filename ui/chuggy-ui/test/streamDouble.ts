/**
 * A stream server made of strings, for the client to be driven against.
 *
 * It answers a scripted list of openings, so a suite says what the server does
 * on the first connection and the second and reads what the client did about
 * it; a body that never ends is how an abort is observed.
 */

import type {
  ProjectStreamPorts,
  StreamBody,
  StreamResponse,
} from "../app/core/projectStream.ts";

export interface StreamOpening {
  readonly status: number;
  readonly chunks?: readonly string[];
  readonly hold?: boolean;
}

export interface StreamServer {
  readonly ports: ProjectStreamPorts;
  readonly headersSeen: Record<string, string>[];
  readonly delaysMs: number[];
  readonly aborts: number[];
  /** Settles once a held body is waiting, so a suite aborts a real read. */
  readonly holding: Promise<void>;
}

const encoder = new TextEncoder();

function bodyOf(
  chunks: readonly string[],
  hold: boolean,
  signal: AbortSignal,
  aborts: number[],
  held: () => void,
): StreamBody {
  let at = 0;
  return {
    getReader: () => ({
      read: async () => {
        const chunk = chunks[at];
        at += 1;
        if (chunk !== undefined)
          return { done: false, value: encoder.encode(chunk) };
        if (!hold) return { done: true };
        if (signal.aborted) {
          aborts.push(1);
          return { done: true };
        }
        return new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              aborts.push(1);
              resolve({ done: true });
            },
            { once: true },
          );
          held();
        });
      },
      cancel: () => Promise.resolve(),
    }),
  };
}

export function streamServer(
  openings: readonly StreamOpening[],
  bearer = "token",
): StreamServer {
  const headersSeen: Record<string, string>[] = [];
  const delaysMs: number[] = [];
  const aborts: number[] = [];
  let held = (): void => undefined;
  const holding = new Promise<void>((resolve) => {
    held = resolve;
  });
  let opened = 0;
  let clockMs = 0;
  const ports: ProjectStreamPorts = {
    fetch: (_url, init) => {
      headersSeen.push(init.headers);
      const opening = openings[opened] ?? { status: 500 };
      opened += 1;
      const response: StreamResponse = {
        status: opening.status,
        body:
          opening.status >= 200 && opening.status < 300
            ? bodyOf(
                opening.chunks ?? [],
                opening.hold ?? false,
                init.signal,
                aborts,
                held,
              )
            : null,
      };
      return Promise.resolve(response);
    },
    bearer: () => Promise.resolve(bearer),
    sleepMs: (ms, signal) => {
      delaysMs.push(ms);
      clockMs += ms;
      return signal.aborted
        ? Promise.reject(new Error("abandoned"))
        : Promise.resolve();
    },
    nowMs: () => clockMs,
  };
  return { ports, headersSeen, delaysMs, aborts, holding };
}

export function frame(
  event: string,
  id: string | undefined,
  data: unknown,
): string {
  const lines = [`event: ${event}`];
  if (id !== undefined) lines.push(`id: ${id}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  return `${lines.join("\n")}\n\n`;
}
