/**
 * A transform takes the text composed so far and the view, and returns what
 * replaces it. A pipeline is these folded in order.
 *
 * One that opens a prompt ignores its input rather than being a kind of its
 * own, so a pipeline can be reordered without its head being retyped.
 */

import type { TransformName } from "./names.ts";

export type Transform<View> = (input: string, view: View) => string;

export interface TraceEntry {
  readonly transformName: TransformName;
  readonly output: string;
}

/** A fold cannot say which transform a line came from; the trace says what the prompt was after each. */
export interface Composition {
  readonly prompt: string;
  readonly trace: readonly TraceEntry[];
}
