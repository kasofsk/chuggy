/**
 * An API double that answers each request with what the case decides and
 * records every request it was sent, its body parsed, so a suite asserts the
 * traffic a screen made rather than a return value. A wait is over at once,
 * and one whose signal has been aborted is refused as the browser's is, so a
 * follow its caller ends stops here as it does there.
 */

import type { ApiPorts } from "../app/core/apiRequest.ts";

export interface Sent {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

export interface Answer {
  readonly status: number;
  readonly body: unknown;
}

export function answeringApi(
  answer: (method: string, path: string, body: unknown) => Answer,
): {
  readonly ports: ApiPorts;
  readonly sent: Sent[];
} {
  const sent: Sent[] = [];
  return {
    sent,
    ports: {
      fetch: (path, init) => {
        const body: unknown =
          typeof init.body === "string" ? JSON.parse(init.body) : init.body;
        sent.push({ method: init.method, path, body });
        const answered = answer(init.method, path, body);
        return Promise.resolve({
          status: answered.status,
          headers: { get: () => null },
          text: () => Promise.resolve(JSON.stringify(answered.body)),
        } as unknown as Response);
      },
      bearer: () => Promise.resolve("token"),
      sleepMs: (_ms, signal) =>
        signal?.aborted === true
          ? Promise.reject(new Error("the wait was abandoned"))
          : Promise.resolve(),
    },
  };
}
