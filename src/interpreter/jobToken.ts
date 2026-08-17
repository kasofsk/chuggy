/**
 * The credential a spawned job carries back, declared here for the reason
 * `registry.ts` gives: two adapters need it, neither may see the other, and the
 * layer between them is where the contract goes. The fabric puts one into a
 * job's environment at spawn; the face verifies it on the completion that job
 * posts back, and the composition root is what hands each side its answer.
 *
 * IT NAMES ONE TASK AND NOTHING ELSE. A completion is a write about exactly one
 * ticket's task, so the credential authorizing it is scoped to that pair — a
 * token good for a whole ticket would let one task answer for another's, and a
 * token good for the fleet would make every worker an operator.
 *
 * NO CRYPTOGRAPHY IS DECLARED HERE, only the shape. This layer holds no ambient
 * capability, so which primitive stands behind a mint is the adapter's to choose
 * and the deployment's to key.
 */

import type { TaskId, TicketId } from "../domain/ids.ts";

/** Mints the credential one spawned job carries back, good for that ticket's task alone. */
export type JobTokenMint = (ticket: TicketId, taskId: TaskId) => string;
