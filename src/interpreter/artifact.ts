/**
 * The task artifact vocabulary: what a completion declaration may carry, typed
 * at this boundary the way the journal is — a schema mirroring the declared
 * type, refusing what it does not describe.
 *
 * THE MODEL'S ARTIFACT STAYS OPAQUE. `ArtifactMark` prices distinctness and
 * nothing else, and no decider reads anything declared here: a declaration's
 * body is world state stored beside the journal, keyed by identities the
 * journal defines, so the machine moves identically whether the body is a
 * branch, prose or nothing. That is what lets this vocabulary grow by
 * deployment decision where the effect vocabulary may not.
 *
 * THE BRANCH CONVENTION LIVES HERE because it is the one name the fabric,
 * the wrap-up performer and every worker must form identically, and a
 * convention with two homes drifts: a work task is told to push
 * `workBranch(ticket, task)`, and the gate re-forms the same name from the
 * journal's mark — the producing task id is derivable, never stored.
 */

import * as z from "zod";

import type { TaskId, TicketId } from "../domain/ids.ts";
import type { Verdict } from "../domain/task.ts";
import { parseRefusal, type Mirrors, type Parsed } from "./wire.ts";

/** What a finished task hands over: a pushed branch, written prose, or nothing at all. */
export type ArtifactBody =
  | { readonly body: "BGitRef"; readonly branch: string }
  | { readonly body: "BNote"; readonly text: string }
  | { readonly body: "BNone" };

/** A worker's completion declaration: the task's one verdict bit, and the body evaluation will install. */
export interface CompletionDeclaration {
  readonly verdict: Verdict;
  readonly artifact: ArtifactBody;
}

const bodySchema = z.discriminatedUnion("body", [
  z.object({ body: z.literal("BGitRef"), branch: z.string().min(1) }),
  z.object({ body: z.literal("BNote"), text: z.string().min(1) }),
  z.object({ body: z.literal("BNone") }),
]);

const declarationSchema = z.object({
  verdict: z.enum(["VPass", "VFail"]),
  artifact: bodySchema,
});

/** The compile-time half of the parse: the schema and the declared type describe each other, on every build. */
export const declarationSchemaMirrorsDeclaration: Mirrors<
  z.infer<typeof declarationSchema>,
  CompletionDeclaration
> = true;

/** Reads one declaration off the wire, refusing anything the vocabulary does not describe. */
export function parseDeclaration(raw: unknown): Parsed<CompletionDeclaration> {
  const result = declarationSchema.safeParse(raw);
  return result.success
    ? { parsed: "Ok", value: result.data }
    : { parsed: "Refused", why: parseRefusal(result.error) };
}

/** The one branch name a ticket's task owns: pushable by that task alone, and re-formable from the journal. */
export function workBranch(ticket: TicketId, taskId: TaskId): string {
  return `chug/t${String(ticket)}/k${String(taskId)}`;
}
