/**
 * An editor following the server draft it is open on: the form held over the
 * draft as the project's cache has it, and the notice drawn where a revision
 * has moved past what is typed or the draft has closed.
 *
 * What moves the form is the core's to decide; this holds the state it
 * decides over, keeps the version a YAML copy was typed over beside that copy
 * so a screen opening on it again knows what it stood on, and draws the
 * choice between taking the draft's revision and keeping one's own.
 */

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { DraftResponse } from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import {
  draftFollowBehindChoice,
  draftFollowBehindSentence,
  draftFollowClosedSentence,
  draftFollowEdited,
  draftFollowed,
  draftFollowKept,
  draftFollowOpened,
  draftFollowStandingOf,
  draftFollowTaken,
} from "../../core/draftFollow.ts";
import type {
  DraftFollowClosed,
  DraftFollowHeld,
  DraftFollowStanding,
} from "../../core/draftFollow.ts";
import { Button } from "../ui/Button.tsx";
import { Notice } from "../ui/Notice.tsx";
import {
  ticketYamlForgotten,
  ticketYamlStored,
  ticketYamlVersionKept,
  ticketYamlVersionStored,
} from "./authoringGuards.tsx";
import type { AuthoringFollow } from "./TicketAuthoring.tsx";

export interface DraftFollowing<Form> {
  /** The revision the form is drawn from, which a submit is written over. */
  readonly base: DraftResponse;
  /** The version what is typed stands on. */
  readonly version: number;
  readonly initial: Form;
  readonly form: Form;
  /** Whether the form says anything its base does not. */
  readonly edited: boolean;
  readonly changed: (form: Form) => void;
  readonly standing: DraftFollowStanding;
  readonly authoring: AuthoringFollow;
  readonly taken: () => void;
  readonly kept: () => void;
}

function draftFollowOpenedFrom<Form>(
  current: DraftResponse,
  storeKey: string,
): DraftFollowHeld<Form> {
  return draftFollowOpened<Form>(
    current,
    ticketYamlStored(storeKey) === undefined
      ? undefined
      : { version: ticketYamlVersionStored(storeKey) },
  );
}

/**
 * The form over a draft as it is revised. `formOf` is read for every revision
 * observed, so a caller holds it steady across renders.
 */
export function useDraftFollow<Form>(input: {
  readonly current: DraftResponse;
  readonly own: DraftResponse | undefined;
  readonly busy: boolean;
  readonly formOf: (draft: DraftResponse) => Form;
  readonly storeKey: string;
}): DraftFollowing<Form> {
  const { current, formOf, storeKey } = input;
  const [held, setHeld] = useState(() =>
    draftFollowOpenedFrom<Form>(current, storeKey),
  );
  const observed = { current, own: input.own, busy: input.busy };
  const followed = draftFollowed(held, observed, formOf);
  if (followed !== held) setHeld(followed);
  const standing = draftFollowStandingOf(followed, observed, formOf);
  const { authored, base, version } = followed;
  const initial = useMemo(() => formOf(base), [formOf, base]);
  const form = followed.edited ?? initial;
  useEffect(() => {
    if (authored) ticketYamlVersionKept(storeKey, version);
  }, [authored, version, storeKey]);
  return {
    base,
    version,
    initial,
    form,
    edited: draftFollowEdited(form, initial),
    changed: (form) => {
      setHeld((last) => ({ ...last, edited: form }));
    },
    standing,
    authoring: {
      seeding: followed.seeding,
      withheld: standing.standing !== "Current",
      onAuthored: (now) => {
        setHeld((last) =>
          last.authored === now ? last : { ...last, authored: now },
        );
      },
    },
    taken: () => {
      ticketYamlForgotten(storeKey);
      setHeld((last) => draftFollowTaken(last, current));
    },
    kept: () => {
      setHeld((last) => draftFollowKept(last, current));
    },
  };
}

/** A draft that is nothing left to release, a released one drawn with the
 * way to its ticket. */
export function DraftClosedNotice(props: {
  readonly closed: DraftFollowClosed;
  readonly released: (ticket: number) => ReactNode;
}): ReactNode {
  const text = useCopyText();
  const closed = props.closed;
  return (
    <Notice
      tone={closed.standing === "Released" ? "info" : "danger"}
      role="status"
      detail={text(draftFollowClosedSentence(closed))}
    >
      {closed.standing === "Released" ? props.released(closed.ticket) : null}
    </Notice>
  );
}

/** What a following editor says of where it stands, and nothing while it is
 * on the draft as it is. */
export function DraftFollowNotice(props: {
  readonly standing: DraftFollowStanding;
  readonly onTaken: () => void;
  readonly onKept: () => void;
  readonly released: (ticket: number) => ReactNode;
}): ReactNode {
  const text = useCopyText();
  const standing = props.standing;
  switch (standing.standing) {
    case "Current":
      return null;
    case "Behind":
      return (
        <Notice
          tone="parked"
          role="status"
          detail={text(draftFollowBehindSentence(standing.current.ticket))}
          more={text(draftFollowBehindChoice)}
        >
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={props.onTaken}>
              {text({ id: "ticket-authoring-take-theirs" })}
            </Button>
            <Button size="sm" onClick={props.onKept}>
              {text({ id: "ticket-authoring-keep-mine" })}
            </Button>
          </div>
        </Notice>
      );
    case "Released":
    case "Deleted":
      return <DraftClosedNotice closed={standing} released={props.released} />;
  }
}
