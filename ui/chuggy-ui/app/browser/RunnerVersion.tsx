/**
 * A runner's version as a table cell: the release it runs, with Outdated where
 * chuggy pins a later one, and the dash where its poll named none.
 */

import type { ReactNode } from "react";

import type { RunnerListedResponse } from "../../../../src/contract/responses.ts";
import { runnerOutdated } from "../core/runners.ts";
import { cellAbsent } from "./TicketCells.tsx";
import { Pill } from "./ui/Pill.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";

export function RunnerVersion(props: {
  readonly runner: RunnerListedResponse | undefined;
}): ReactNode {
  const runner = props.runner;
  if (runner === undefined) return cellAbsent;
  const pinned = runner.pinned;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {runner.version}
      {pinned !== undefined && runnerOutdated(runner.version, pinned) ? (
        <Tooltip text={`${pinned} available`}>
          <span>
            <Pill tone="parked">Outdated</Pill>
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}
