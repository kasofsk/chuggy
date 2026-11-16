/**
 * `north-star`: the project's North Star written into its settings, and what
 * the step's offer turns on of the folder.
 *
 * The offer turns on whether the folder's checkout tracks any file, asked of
 * git and never printed: where it does, the agent drafts the North Star from
 * the folder, and where it does not, or there is no checkout, or git did not
 * answer, from one question put to the person. The write is the console's
 * own: the settings read, then written whole under the revision read, with
 * only the North Star changed. A write the revision moved under reads again
 * and writes once more. Whether the step is done is the checklist's to say,
 * read after.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { nativeHttpRoutes } from "../../../../src/contract/http.ts";
import type { SelectorProjectSettingsResponse } from "../../../../src/contract/responses.ts";

import type { ApiPorts, ApiResult } from "./apiRequest.ts";
import { apiSelectorSettings, apiWriteSelectorSettings } from "./apiRoutes.ts";
import { failureWords } from "./failureWords.ts";
import type { SetupProcessPort } from "./setupPorts.ts";
import type { SetupNorthStarAnswered } from "./setupReport.ts";

/** What git is asked, in the folder the program was run in: the files its checkout tracks, each ended by a NUL. */
export const setupTrackedCommand: readonly string[] = ["git", "ls-files", "-z"];

/** Past what it takes to see that a checkout tracks any file; what git prints beyond it is let go of. */
export const setupTrackedBytesMax = 4_096;

/** Whether the folder's checkout tracks any file, tracks none, or could not be read as a checkout at all. */
export type SetupTracked = "Files" | "None" | "Unread";

/** The files the folder's checkout tracks, asked of git once and for at most `waitMs`, counted as far as what it printed was kept. */
export async function setupTrackedRead(
  process: SetupProcessPort,
  waitMs: number,
): Promise<SetupTracked> {
  const ended = await process.run(
    setupTrackedCommand,
    waitMs,
    setupTrackedBytesMax,
  );
  if (ended.ended !== "Exited" || ended.exit !== 0) return "Unread";
  const files = ended.out.split("\0").filter((name) => name !== "").length;
  return files > 0 ? "Files" : "None";
}

/** The one write `north-star` makes for a project: its settings, written whole. */
export function setupNorthStarWrites(
  partition: PartitionIdentity,
): readonly string[] {
  const route = nativeHttpRoutes.selectorSettings
    .replace(":tenant", encodeURIComponent(partition.tenant))
    .replace(":project", encodeURIComponent(partition.project));
  return [`PUT ${route}`];
}

/** The settings read, then written under the revision read with the North Star set and every other override as it was read. */
async function setupNorthStarWrite(
  ports: ApiPorts,
  partition: PartitionIdentity,
  text: string,
): Promise<ApiResult<SelectorProjectSettingsResponse>> {
  const read = await apiSelectorSettings(ports, partition);
  if (read.outcome !== "Ok") return read;
  return apiWriteSelectorSettings(ports, partition, {
    expectedRevision: read.value.revision,
    overrides: { ...read.value.overrides, northStar: text },
  });
}

/** Writes `text` as the project's North Star through ports that let out only `setupNorthStarWrites`'s write, trying once more where the revision moved under the first. */
export async function setupNorthStarWritten(
  ports: ApiPorts,
  partition: PartitionIdentity,
  text: string,
): Promise<SetupNorthStarAnswered> {
  const first = await setupNorthStarWrite(ports, partition, text);
  const written =
    first.outcome === "Conflict"
      ? await setupNorthStarWrite(ports, partition, text)
      : first;
  return written.outcome === "Ok"
    ? { answered: "Written" }
    : { answered: "Failed", failure: failureWords(written).word };
}
