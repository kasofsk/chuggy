/**
 * What a personal runner's newest poll leaves on its row, planted as the row:
 * whether it polled for executions just now, the capabilities it holds, that
 * it advertised its agents, the names it gave Claude's credentials, and the
 * memory room it named.
 */
import { workerPoolAgentToken } from "../../src/interpreter/workerPoolAssignment.ts";
import type { PostgresHarness } from "./harness.ts";

/** The platform a planted runner holds where a case names no capabilities of its own. */
export const personalRunnerHarnessPlatform = "Platform:Linux:Amd64";

/** What a runner's newest poll left it as: live for executions or not, offered Claude unless `offered` is false, with `capabilities` where a case names its own, naming `credentials` of Claude where it names any, and naming a memory room of `roomMib` where it names one. */
export interface PersonalRunnerHarnessPolled {
  readonly live: boolean;
  readonly offered?: boolean;
  readonly capabilities?: readonly string[];
  readonly credentials?: readonly string[];
  readonly roomMib?: number;
}

/** Writes onto the row of the runner `principal` names what a poll of `polled` writes, advertising its agents. */
export async function personalRunnerHarnessPolled(
  harness: PostgresHarness,
  principal: string,
  polled: PersonalRunnerHarnessPolled,
): Promise<void> {
  const offered =
    polled.offered === false ? [] : [workerPoolAgentToken("Claude")];
  await harness.query(
    `UPDATE personal_runner SET executions_polled_at=CASE WHEN $2::boolean THEN now() END,
       agents_advertised=true,capabilities=$3::text[],credentials_named=$4::jsonb,
       memory_room_mib=$5::bigint
     WHERE principal=$1`,
    [
      principal,
      polled.live,
      polled.capabilities ?? [personalRunnerHarnessPlatform, ...offered],
      polled.credentials === undefined
        ? null
        : JSON.stringify({ Claude: polled.credentials }),
      polled.roomMib ?? null,
    ],
  );
}
