import { poolPlaneRole, schedulerRole, type Migration } from "../shared.ts";

/**
 * How many attempts of one task were claimed and then said nothing at all,
 * which is the only shape of stuck work no other column can see.
 *
 * A CLAIM THAT ENDS IN SILENCE IS NOT A CLAIM THAT ANSWERED. A pool that is
 * busy releases the row, a pool that will not run the work records its
 * refusal, and a harness that ran records its outcome; each of those is an
 * answer the orchestrator acts on. A workload a fabric accepted and no node
 * can ever schedule produces none of them: the lease simply runs out, the
 * claim predicate takes the row back, another pool claims it, and the cycle
 * repeats for as long as the project lives. Counting claims cannot tell the
 * two apart, because a released claim spends one too.
 *
 * So the count is of attempts that expired having reported nothing, it is
 * incremented by the claim that finds one, and a ceiling on it is what turns
 * the cycle into ticket evidence. Rows written before this migration start at
 * zero: what their earlier attempts did is not recoverable, and a count that
 * guessed would settle work that is running.
 *
 * BOTH CLAIMANTS COUNT, SO BOTH ARE GRANTED THE COLUMN. The plane serving
 * pools is also given the harness outcome to read, because a claim that tells
 * silence from an answer has to see that there was none; it reads whether that
 * column is null and nothing else.
 */
export const migration012: Migration = {
  version: 12,
  name: "execution-unreported-attempts",
  statements: [
    `ALTER TABLE ticket_execution
       ADD COLUMN attempts_unreported integer NOT NULL DEFAULT 0`,
    `GRANT UPDATE(attempts_unreported) ON ticket_execution TO ${schedulerRole}`,
    `GRANT SELECT(attempts_unreported,worker_outcome) ON ticket_execution TO ${poolPlaneRole}`,
    `GRANT UPDATE(attempts_unreported) ON ticket_execution TO ${poolPlaneRole}`,
  ],
};
