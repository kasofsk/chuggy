/**
 * Where the project's threads and lead run and the runners they would run on,
 * as every screen that says so reads it, and the one line that says a runner,
 * or the reader's chat host, cannot take a turn now.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { SessionPlacementResponse } from "../../../../src/contract/responses.ts";
import { apiSessionPlacement } from "../core/apiRoutes.ts";
import type { PanelState } from "../core/freshness.ts";
import { projectResourceKey } from "../core/projectQueryKeys.ts";
import { navRoutes } from "../core/shellNav.ts";
import {
  sessionPlacementPolledMs,
  sessionPlacementShort,
  sessionRunnerAdded,
  sessionRunnerNoticeWord,
} from "../core/sessionRunners.ts";
import type {
  SessionRunnerSession,
  SessionRunnerShort,
} from "../core/sessionRunners.ts";
import { settingsRoutes } from "../core/settingsNav.ts";
import {
  usePanelAnswers,
  usePanelReread,
  usePanelResourceSettled,
} from "./api.ts";
import { Notice } from "./ui/Notice.tsx";

/** No frame names the placement or a runner's poll, so the read is polled. */
export const sessionPlacementResource = "session-placement";

/** The placement, with whether its read has ever come back. */
export function useSessionPlacementSettled(partition: PartitionIdentity): {
  readonly state: PanelState<SessionPlacementResponse>;
  readonly settled: boolean;
} {
  return usePanelResourceSettled(
    partition,
    "Project",
    sessionPlacementResource,
    (ports) => apiSessionPlacement(ports, partition),
    sessionPlacementPolledMs,
  );
}

export function useSessionPlacement(
  partition: PartitionIdentity,
): PanelState<SessionPlacementResponse> {
  return useSessionPlacementSettled(partition).state;
}

/** Why no runner can take one session's turn, once the placement is read. */
export function useSessionRunnerShort(
  partition: PartitionIdentity,
  session: "thread" | "lead",
  runners: keyof SessionPlacementResponse["runners"],
): SessionRunnerShort | undefined {
  const placement = useSessionPlacement(partition);
  return sessionPlacementShort(
    placement.state === "Ready" ? placement.value : undefined,
    session,
    runners,
  );
}

/** How many times the placement has answered: every read that landed and
 * every write held as one moves it, and a failed read does not. */
export function useSessionPlacementReads(partition: PartitionIdentity): number {
  return usePanelAnswers(
    projectResourceKey(partition, "Project", sessionPlacementResource),
  );
}

/** Reads the placement again now, for a door whose refusal is newer than it:
 * the route or the reader's runner has moved since the last poll. Answers, once
 * the read has, how many reads had answered when the refusal arrived. */
export function useSessionPlacementStale(
  partition: PartitionIdentity,
): () => Promise<number> {
  return usePanelReread(
    projectResourceKey(partition, "Project", sessionPlacementResource),
  );
}

function SessionRunnerAddLink(props: {
  readonly partition: PartitionIdentity;
  readonly session: SessionRunnerSession;
}): ReactNode {
  switch (sessionRunnerAdded(props.session)) {
    case "MyRunner":
      return (
        <Link to={settingsRoutes.project.myRunner} params={props.partition}>
          My runners
        </Link>
      );
    case "Runners":
      return (
        <Link to={navRoutes.runners} params={props.partition}>
          Runners
        </Link>
      );
  }
}

/** Why no runner can take a turn now, and the link to where one is added
 * where none is. */
function SessionRunnerNoticeLine(props: {
  readonly session: SessionRunnerSession;
  readonly short: SessionRunnerShort;
  readonly add: ReactNode;
}): ReactNode {
  return (
    <Notice
      tone="parked"
      inline
      detail={sessionRunnerNoticeWord(props.short, props.session)}
    >
      {props.short === "NoRunner" ? (
        <span className="text-ink-3">
          {" · "}
          {props.add}
        </span>
      ) : null}
    </Notice>
  );
}

/** Why no runner can take a turn now, with where one is added where none is. */
export function SessionRunnerNotice(props: {
  readonly partition: PartitionIdentity;
  readonly session: SessionRunnerSession;
  readonly short: SessionRunnerShort;
}): ReactNode {
  return (
    <SessionRunnerNoticeLine
      session={props.session}
      short={props.short}
      add={
        <SessionRunnerAddLink
          partition={props.partition}
          session={props.session}
        />
      }
    />
  );
}

/** Why the reader's chat host cannot take a turn of their own chat now, with
 * their own page in the workspace, where one is registered, where none is. */
export function ChatHostNotice(props: {
  readonly tenant: string;
  readonly short: SessionRunnerShort;
}): ReactNode {
  return (
    <SessionRunnerNoticeLine
      session="Chat"
      short={props.short}
      add={
        <Link
          to={settingsRoutes.workspace.myRunner}
          params={{ tenant: props.tenant }}
        >
          My runners
        </Link>
      }
    />
  );
}
