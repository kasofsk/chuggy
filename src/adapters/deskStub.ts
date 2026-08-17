/**
 * The desk, as a stub: a board keyed by emission identity, and a log of every
 * delivery the board was handed.
 *
 * THE TWO TOGETHER ARE WHAT MAKE AT-LEAST-ONCE OBSERVABLE. The board absorbs —
 * a repeated `emissionKey` lands on the row it already holds — and the log
 * counts what arrived, so a duplicate delivered and a board that did not move
 * are two readings of the same run rather than one claim about it. A real desk
 * adapter owes the same absorption against its own store, and the port says so.
 */

import type { Effect } from "../domain/effect.ts";
import {
  emissionKey,
  type DeskPort,
  type Emission,
} from "../interpreter/ports.ts";

/** One row of the board: which instruction, about which decision and ticket. */
export interface DeskRow {
  readonly effect: Effect;
  readonly emission: Emission;
}

/** The desk with both readings exposed: what it holds, and what it was handed. */
export interface DeskStub extends DeskPort {
  readonly board: ReadonlyMap<string, DeskRow>;
  readonly deliveries: readonly DeskRow[];
}

/** A fresh desk: an empty board, and nothing delivered to it yet. */
export function deskStub(): DeskStub {
  const board = new Map<string, DeskRow>();
  const deliveries: DeskRow[] = [];
  const post = (effect: Effect, emission: Emission): Promise<void> => {
    const row: DeskRow = { effect, emission };
    deliveries.push(row);
    board.set(emissionKey(emission), row);
    return Promise.resolve();
  };
  return {
    board,
    deliveries,
    createDraft: (emission) => post("CreateDraft", emission),
    revoke: (emission) => post("Revoke", emission),
    openHumanTask: (emission) => post("OpenHumanTask", emission),
    enqueueWrapUp: (emission) => post("EnqueueWrapUp", emission),
    openGate: (emission) => post("OpenGate", emission),
    complete: (emission) => post("Complete", emission),
  };
}
