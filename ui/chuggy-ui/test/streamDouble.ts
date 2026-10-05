/**
 * A stream server made of strings, for the client to be driven against.
 *
 * It answers a scripted list of openings, so a suite says what the server does
 * on the first connection and the second and reads what the client did about
 * it; a body that never ends is how an abort is observed, and `push` is how a
 * suite sends a frame after the screen it is testing has done something.
 *
 * A thread's live route is a second script beside the project's, told apart by
 * the address asked: a suite that scripts none has it answered as a thread that
 * is not there, which a client stops on without asking again.
 *
 * A server that cuts a stream is a read that fails: `cut` on an opening fails
 * the read after its last chunk, and `cutLive` fails the read that is waiting.
 * The clock moves only when the client sleeps, so `lastsMs` is how an opening
 * is said to have stayed open.
 */

import type {
  StreamBody,
  StreamPorts,
  StreamResponse,
} from "../app/core/streamConnection.ts";

export interface StreamOpening {
  readonly status: number;
  readonly chunks?: readonly string[];
  readonly hold?: boolean;
  /** Whether the read after the last chunk fails, as a connection reset does. */
  readonly cut?: boolean;
  /** How long the opening has been open by the time its chunks are read. */
  readonly lastsMs?: number;
  /** The `retry-after` header the opening is answered with. */
  readonly retryAfter?: string;
}

export interface StreamServer {
  readonly ports: StreamPorts;
  readonly headersSeen: Record<string, string>[];
  /** The address and headers of each open of a live route, in order. */
  readonly liveSeen: {
    readonly url: string;
    readonly headers: Record<string, string>;
  }[];
  readonly delaysMs: number[];
  readonly aborts: number[];
  /** Settles once a held body is waiting, so a suite aborts a real read. */
  readonly holding: Promise<void>;
  /** One more frame down the connection that is open, whenever the suite says. */
  readonly push: (chunk: string) => void;
  /** The same, down the live connection that is open. */
  readonly pushLive: (chunk: string) => void;
  /** Ends the live connection that is open, as a server closing it does. */
  readonly closeLive: () => void;
  /** Fails the read the live connection is waiting on, as a reset does. */
  readonly cutLive: () => void;
}

type StreamChunkRead =
  | { readonly done: false; readonly value: Uint8Array }
  | { readonly done: true };

type StreamChunkWaiter = (read: StreamChunkRead | Error) => void;

/** What a read rejects with when the connection under it is reset. */
function streamCut(): Error {
  return new TypeError("network error");
}

const encoder = new TextEncoder();

/** Which path a thread's live stream is asked on. */
const liveRoutePattern = /\/threads\/[^/]+\/live$/u;

/** What one open body needs of the route it is answered on. */
interface StreamBodyRoute {
  readonly queued: string[];
  readonly opening: StreamOpening;
  readonly signal: AbortSignal;
  readonly aborts: number[];
  readonly held: () => void;
  /** Called once the opening's chunks have all been read. */
  readonly drained: () => void;
  readonly waiting: (waiter: StreamChunkWaiter | undefined) => void;
}

function bodyOf(route: StreamBodyRoute): StreamBody {
  const { queued, opening, signal, aborts, waiting } = route;
  return {
    getReader: () => ({
      read: async () => {
        const chunk = queued.shift();
        if (chunk !== undefined)
          return { done: false, value: encoder.encode(chunk) };
        route.drained();
        if (opening.cut === true) throw streamCut();
        if (opening.hold !== true) return { done: true };
        if (signal.aborted) {
          aborts.push(1);
          return { done: true };
        }
        return new Promise<StreamChunkRead>((resolve, reject) => {
          const abandoned = (): void => {
            aborts.push(1);
            waiting(undefined);
            resolve({ done: true });
          };
          waiting((read) => {
            waiting(undefined);
            signal.removeEventListener("abort", abandoned);
            if (read instanceof Error) reject(read);
            else resolve(read);
          });
          signal.addEventListener("abort", abandoned, { once: true });
          route.held();
        });
      },
      cancel: () => Promise.resolve(),
    }),
  };
}

/** One route's script: its openings answered in order, the status given once
 * they run out, and a way to send down whichever of them is open. */
interface StreamRoute {
  readonly answered: (signal: AbortSignal) => StreamResponse;
  readonly push: (chunk: string) => void;
  readonly close: () => void;
  readonly cut: () => void;
}

function routeOf(
  openings: readonly StreamOpening[],
  exhaustedStatus: number,
  aborts: number[],
  held: () => void,
  lasted: (ms: number) => void,
): StreamRoute {
  let opened = 0;
  let pending: StreamChunkWaiter | undefined;
  let queued: string[] = [];
  return {
    answered: (signal) => {
      const opening = openings[opened] ?? { status: exhaustedStatus };
      opened += 1;
      queued = [...(opening.chunks ?? [])];
      let drained = false;
      const body = bodyOf({
        queued,
        opening,
        signal,
        aborts,
        held,
        drained: () => {
          if (!drained) lasted(opening.lastsMs ?? 0);
          drained = true;
        },
        waiting: (waiter) => {
          pending = waiter;
        },
      });
      return {
        status: opening.status,
        body: opening.status >= 200 && opening.status < 300 ? body : null,
        retryAfter: opening.retryAfter,
      };
    },
    /** Handed straight to a read that is waiting, and queued for the next one
     * when none is. */
    push: (chunk) => {
      const waiter = pending;
      if (waiter === undefined) {
        queued.push(chunk);
        return;
      }
      waiter({ done: false, value: encoder.encode(chunk) });
    },
    close: () => {
      pending?.({ done: true });
    },
    cut: () => {
      pending?.(streamCut());
    },
  };
}

export function streamServer(
  openings: readonly StreamOpening[],
  bearer = "token",
  liveOpenings: readonly StreamOpening[] = [],
): StreamServer {
  const headersSeen: Record<string, string>[] = [];
  const liveSeen: StreamServer["liveSeen"] = [];
  const delaysMs: number[] = [];
  const aborts: number[] = [];
  let held = (): void => undefined;
  const holding = new Promise<void>((resolve) => {
    held = resolve;
  });
  let clockMs = 0;
  const lasted = (ms: number): void => {
    clockMs += ms;
  };
  const project = routeOf(
    openings,
    500,
    aborts,
    () => {
      held();
    },
    lasted,
  );
  const live = routeOf(liveOpenings, 404, aborts, () => undefined, lasted);
  const ports: StreamPorts = {
    fetch: (url, init) => {
      if (liveRoutePattern.test(url)) {
        liveSeen.push({ url, headers: init.headers });
        return Promise.resolve(live.answered(init.signal));
      }
      headersSeen.push(init.headers);
      return Promise.resolve(project.answered(init.signal));
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
  return {
    ports,
    headersSeen,
    liveSeen,
    delaysMs,
    aborts,
    holding,
    push: project.push,
    pushLive: live.push,
    closeLive: live.close,
    cutLive: live.cut,
  };
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
