/**
 * Where the project's threads run and the runners they would run on,
 * as every screen that says so reads it, and the one line that says a runner,
 * or the reader's chat host, cannot take a turn now.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { SessionPlacementResponse } from "../../../../src/contract/responses.ts";
import { useCopyText } from "../copy/CopyProvider.tsx";
import type { PanelState } from "../core/freshness.ts";
import { sessionPlacementQuery } from "../core/projectQueries.ts";
import {
  sessionPlacementShort,
  sessionRunnerNoticeWord,
} from "../core/sessionRunners.ts";
import type { SessionRunnerShort } from "../core/sessionRunners.ts";
import { settingsRoutes } from "../core/settingsNav.ts";
import { usePanelAnswers, usePanelState } from "./api.ts";
import { Notice } from "./ui/Notice.tsx";

/** The placement, with whether its read has ever come back. */
export function useSessionPlacementSettled(partition: PartitionIdentity): {
  readonly state: PanelState<SessionPlacementResponse>;
  readonly settled: boolean;
} {
  return usePanelState(sessionPlacementQuery(partition), (state, answer) => ({
    state,
    settled: answer.isFetched,
  }));
}

export function useSessionPlacement(
  partition: PartitionIdentity,
): PanelState<SessionPlacementResponse> {
  return useSessionPlacementSettled(partition).state;
}

/** Why no runner can take one session's turn, once the placement is read. */
export function useSessionRunnerShort(
  partition: PartitionIdentity,
  runners: keyof SessionPlacementResponse["runners"],
): SessionRunnerShort | undefined {
  const placement = useSessionPlacement(partition);
  return sessionPlacementShort(
    placement.state === "Ready" ? placement.value : undefined,
    runners,
  );
}

/** How many times the placement has answered: every read that landed and
 * every write held as one moves it, and a failed read does not. */
export function useSessionPlacementReads(partition: PartitionIdentity): number {
  return usePanelAnswers(sessionPlacementQuery(partition).queryKey);
}

/** A thread's missing runner is added on its member's own page. */
function SessionRunnerAddLink(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const text = useCopyText();
  return (
    <Link to={settingsRoutes.project.myRunner} params={props.partition}>
      {text({ id: "runners-personal-link" })}
    </Link>
  );
}

/** Why no runner can take a turn now, and the link to the reader's own
 * runner's page, where one is added where none is and an offline one is
 * replaced. */
function SessionRunnerNoticeLine(props: {
  readonly short: SessionRunnerShort;
  readonly add: ReactNode;
}): ReactNode {
  const text = useCopyText();
  return (
    <Notice
      tone="parked"
      inline
      detail={text(sessionRunnerNoticeWord(props.short))}
    >
      <span className="text-ink-3">
        {" · "}
        {props.add}
      </span>
    </Notice>
  );
}

/** A session's line above, linked to the page its runner is added on. */
export function SessionRunnerNotice(props: {
  readonly partition: PartitionIdentity;
  readonly short: SessionRunnerShort;
}): ReactNode {
  return (
    <SessionRunnerNoticeLine
      short={props.short}
      add={<SessionRunnerAddLink partition={props.partition} />}
    />
  );
}

/** Why the reader's chat host cannot take a turn of their own chat now, with
 * their own page in the workspace. */
export function ChatHostNotice(props: {
  readonly tenant: string;
  readonly short: SessionRunnerShort;
}): ReactNode {
  const text = useCopyText();
  return (
    <SessionRunnerNoticeLine
      short={props.short}
      add={
        <Link
          to={settingsRoutes.workspace.myRunner}
          params={{ tenant: props.tenant }}
        >
          {text({ id: "runners-personal-link" })}
        </Link>
      }
    />
  );
}
