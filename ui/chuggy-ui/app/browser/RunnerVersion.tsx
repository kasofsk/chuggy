/**
 * A runner's version as a table cell: the release it runs, after its package
 * where `named`, with Outdated where chuggy pins a later one, and the dash
 * where its poll named none.
 */

import type { ReactNode } from "react";

import type { RunnerListedResponse } from "../../../../src/contract/responses.ts";
import { useCopyText } from "../copy/CopyProvider.tsx";
import { runnerOutdated } from "../core/runners.ts";
import { cellAbsent } from "./TicketCells.tsx";
import { Pill } from "./ui/Pill.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";

export function RunnerVersion(props: {
  readonly runner: RunnerListedResponse | undefined;
  readonly named?: boolean;
}): ReactNode {
  const text = useCopyText();
  const runner = props.runner;
  if (runner === undefined) return cellAbsent;
  const pinned = runner.pinned;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {props.named === true
        ? text({
            id: "runners-version-named",
            args: { package: runner.package, version: runner.version },
          })
        : runner.version}
      {pinned !== undefined && runnerOutdated(runner.version, pinned) ? (
        <Tooltip
          text={{ id: "runners-version-available", args: { version: pinned } }}
        >
          <span>
            <Pill tone="parked">
              {text({ id: "runners-version-outdated" })}
            </Pill>
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}
