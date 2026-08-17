/**
 * The actor's own next moves after a decision, pure over the enablement sets.
 *
 * Each internal command is read off the set that enables it: a work reduce per
 * fully-resolved working ticket, an eval reduce per fully-resolved evaluating
 * one, a dequeue per enqueued ticket whose gate is free, and one dispatch for
 * the policy's pick. The agenda is bounded because every command on it
 * descends the measure, which is what lets the drive run it to a fixpoint
 * with no counter of its own.
 *
 * THE DEQUEUE IS ALWAYS DRAWN MOVED. The dequeue with `moved` false completes
 * the ticket in the same decision, before any physical attempt could run; a
 * deployment performing a real wrap-up always draws it true and lets the gate
 * carry the attempt. Always-true is a legal refinement of the invalidation
 * draw, and it keeps failure drawable only against an invalidated artifact.
 */

import {
  jDequeue,
  jDispatch,
  jEvalReduce,
  jWorkReduce,
  type Cmd,
} from "../actor/command.ts";
import type { Core } from "../domain/core.ts";
import {
  dispatchableIn,
  readiesIn,
  reducibleEvalIn,
  reducibleWorkIn,
  wrapUpStartablesIn,
} from "../domain/enablement.ts";
import { policyPick } from "./policy.ts";

/** Every internal command enabled at this fleet, reduces before dequeues before the one dispatch. */
export function followUpsIn(core: Core): readonly Cmd[] {
  const pick = policyPick(
    readiesIn(core).filter((ticket) => dispatchableIn(core, ticket)),
  );
  return [
    ...reducibleWorkIn(core).map(jWorkReduce),
    ...reducibleEvalIn(core).map(jEvalReduce),
    ...wrapUpStartablesIn(core).map((ticket) => jDequeue(ticket, true)),
    ...(pick === undefined ? [] : [jDispatch(pick)]),
  ];
}
