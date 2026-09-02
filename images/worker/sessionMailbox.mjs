/**
 * The session's mailbox: the long-poll claim against the worker plane, and the
 * async iterable of user messages it feeds one `query()`.
 *
 * ONE TURN IS IN FLIGHT AT A TIME, and the generator is what enforces it. After
 * yielding a turn it blocks until the pod says that turn settled, so the runtime
 * cannot be handed a second turn while the first is still being answered — and
 * so nothing belonging to a later turn can arrive while the pod is draining the
 * current one's messages.
 *
 * BOTH LOOPS ARE BOUNDED. One request is bounded by the plane's own long poll,
 * and the loop as a whole by the idle bound the pod was launched with: a
 * mailbox that stays empty that long ends the iterable, the query ends with it,
 * and the process exits for the scheduler's idle reaper to collect.
 *
 * A CLAIM IS ANNOUNCED BEFORE THE TURN IS YIELDED, which is what lets the pod
 * reset anything a turn owns — its decision staging — with no way for one turn's
 * state to be read by the next.
 *
 * THE IDLE WINDOW OPENS ON THE FIRST EMPTY POLL, NOT WHEN THE POD STARTED. A
 * cold session pages a resumed store and spawns a runtime before this loop is
 * asked for anything, and a startup slower than the bound would then end the
 * iterable on its first look at an empty mailbox. Idle is time the session spent
 * with nothing to do, so it is measured from the first moment it had nothing to
 * do, and a claim closes the window again.
 */

import { setTimeout as wait } from "node:timers/promises";

import { sessionRequest, sessionStopped } from "./sessionTransport.mjs";

const claimedStatus = 200;
const emptyStatus = 204;

/** One claimed turn as the runtime's streaming input takes it. */
export function sessionUserMessage(input) {
  return {
    type: "user",
    session_id: "",
    parent_tool_use_id: null,
    message: { role: "user", content: input },
  };
}

export function sessionMailbox(task, bearer, services = {}) {
  const {
    request = sessionRequest,
    wait: pause = wait,
    now = Date.now,
    claim: onClaim = () => undefined,
  } = services;
  let held;
  let stopped = false;
  let settle = () => undefined;
  let awaitSettled = Promise.resolve();
  let idleSince;

  function hold() {
    awaitSettled = new Promise((resolve) => {
      settle = resolve;
    });
  }

  async function claim() {
    const response = await request(task, bearer, "/v1/session/turn", {
      method: "GET",
    });
    if (sessionStopped(response) || response.status === emptyStatus)
      return sessionStopped(response) ? "Stop" : undefined;
    if (response.status !== claimedStatus)
      throw new Error(
        `the session mailbox answered ${String(response.status)}`,
      );
    return response.json();
  }

  return {
    claimed: () => held,

    /** What the pod calls once a turn is answered or failed, releasing the next. */
    settled() {
      held = undefined;
      settle();
    },

    /** What ends the iterable, and with it the query, without another claim. */
    stop() {
      stopped = true;
      settle();
    },

    async *turns() {
      for (;;) {
        await awaitSettled;
        if (stopped) return;
        const turn = await claim();
        if (turn === "Stop") return;
        if (turn === undefined) {
          idleSince ??= now();
          if (now() - idleSince >= task.bounds.idleMs) return;
          await pause(task.bounds.mailboxPollMs);
          continue;
        }
        held = turn;
        idleSince = undefined;
        onClaim(turn);
        hold();
        yield sessionUserMessage(turn.input);
      }
    },
  };
}
