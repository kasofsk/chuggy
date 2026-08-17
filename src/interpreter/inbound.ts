/**
 * The inbound face: what the world may tell the actor, declared beside the
 * ports for the same reason the ports are declared here — an adapter that
 * answers a port also carries deliveries back in, and this file is the whole
 * of what it may say. Whatever drives the actor implements it; the
 * composition root hands it to the adapters as a value, so an adapter's
 * imports still end at this layer.
 *
 * A SUBMISSION IS ANSWERED, NEVER ASSUMED. `Accepted` carries the sequence
 * number the decision journaled, so an implementor can withhold the answer
 * until the entry would survive a crash — the acknowledgement a worker
 * receives is journal-before-ack by construction, not by convention. A drop
 * is an answer too: it names why, and the world's delivery duty ends with it.
 * Delivering less than the environment may deliver refines the environment,
 * which is why a completion naming a task no longer live may be dropped here
 * rather than journaled as a duplicate row.
 *
 * WHAT IS ABSENT IS THE POINT. No dispatch, no reduce, no dequeue: those are
 * the actor's own follow-ups, decided above this face, and a world that could
 * submit them would be a second decider. The face carries exactly the
 * environment's draws — the desk's authored acts on one side, the fabric's
 * completions and the performer's gate outcomes on the other.
 */

import type { ProjectId, TaskId, TicketId } from "../domain/ids.ts";
import type { Stage } from "../domain/program.ts";
import type { Verdict } from "../domain/task.ts";
import type { WrapUp, WrapUpOutcome } from "../domain/wrapUp.ts";

/** The actor's answer to a submission: the sequence number it journaled, or the reason it took nothing. */
export type Submitted =
  | { readonly submitted: "Accepted"; readonly seq: number }
  | { readonly submitted: "Dropped"; readonly why: string };

/** What the world may tell the actor, each method one environment draw. */
export interface Inbound {
  /** An authored ticket at its draws. */
  arrive(
    deps: readonly TicketId[],
    program: readonly Stage[],
    project: ProjectId,
    wrapUp: WrapUp,
  ): Promise<Submitted>;

  release(ticket: TicketId): Promise<Submitted>;

  revoke(ticket: TicketId): Promise<Submitted>;

  opRetry(ticket: TicketId): Promise<Submitted>;

  /** A completion delivery, at-least-once: the verdict is the task's one bit, and a repeat or a straggler for a task no longer live is dropped. */
  taskDone(
    ticket: TicketId,
    taskId: TaskId,
    verdict: Verdict,
  ): Promise<Submitted>;

  /** The wrap-up attempt's outcome for the ticket holding the lease, from the performer or from an operator's hand. */
  gateOutcome(ticket: TicketId, outcome: WrapUpOutcome): Promise<Submitted>;
}
