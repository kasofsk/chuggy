/**
 * A mutation and what answering it does: the button, one fragment of effect
 * with its cost, and at most one more.
 *
 * Total over `actionStates` — ready, busy, refused, and offered-not-at-all —
 * each in the full form the ticket page draws and the compact form a table row
 * has room for. A refusal is visible text and never a `title`, because a reason
 * a reader has to hover for is a reason they will not find; an answer the
 * machine does not admit draws no button at all, because a wall whose only exit
 * is elsewhere must not offer a control that submits into it.
 *
 * The effect's id comes from `useId`, so it is a single token whatever the
 * action is called and is unique across however many of these a page draws —
 * `aria-describedby` is an id-reference list, and an action word with a space
 * in it would split into two references naming nothing.
 */

import { useId } from "react";
import type { ReactNode } from "react";

import { Button } from "./Button.tsx";

import "./ActionWithCost.css";

export const actionStates = ["ready", "busy", "refused", "absent"] as const;

export type ActionState = (typeof actionStates)[number];

export const actionForms = ["full", "compact"] as const;

export type ActionForm = (typeof actionForms)[number];

export interface ActionWithCostProps {
  readonly action: string;
  readonly effect: string;
  readonly cost?: string;
  readonly more?: string;
  readonly busy?: boolean;
  readonly refusedBecause?: string;
  readonly offered?: boolean;
  readonly danger?: boolean;
  readonly variant?: ActionForm;
  readonly onChoose: () => void;
}

export function actionStateOf(props: ActionWithCostProps): ActionState {
  if (props.offered === false) return "absent";
  if (props.refusedBecause !== undefined) return "refused";
  return props.busy === true ? "busy" : "ready";
}

function ActionLines(props: {
  readonly effect: string;
  readonly cost: string | undefined;
  readonly more: string | undefined;
  readonly refusedBecause: string | undefined;
  readonly describedBy: string;
  readonly hidden: boolean;
}): ReactNode {
  return (
    <>
      <p
        className={props.hidden ? "act-effect visually-hidden" : "act-effect"}
        id={props.describedBy}
      >
        {props.effect}
        {props.cost === undefined ? null : (
          <span className="act-cost"> · {props.cost}</span>
        )}
      </p>
      {props.more === undefined || props.hidden ? null : (
        <p className="act-more">{props.more}</p>
      )}
      {props.refusedBecause === undefined ? null : (
        <p className="act-refused">{props.refusedBecause}</p>
      )}
    </>
  );
}

/** No button: the line alone, which is the whole of what the machine offers. */
function ActionAbsent(props: {
  readonly effect: string;
  readonly more: string | undefined;
  readonly compact: boolean;
}): ReactNode {
  return (
    <div className={props.compact ? "act act-compact" : "act"}>
      <p className="act-more">
        {props.more === undefined
          ? props.effect
          : `${props.effect} · ${props.more}`}
      </p>
    </div>
  );
}

export function ActionWithCost(props: ActionWithCostProps): ReactNode {
  const describedBy = useId();
  const state = actionStateOf(props);
  const compact = props.variant === "compact";
  if (state === "absent")
    return (
      <ActionAbsent effect={props.effect} more={props.more} compact={compact} />
    );
  return (
    <div className={compact ? "act act-compact" : "act"}>
      <div className="act-head">
        <Button
          variant={props.danger === true ? "danger" : "default"}
          size={compact ? "sm" : "md"}
          disabled={state !== "ready"}
          busy={state === "busy"}
          describedBy={describedBy}
          onClick={props.onChoose}
        >
          {props.action}
        </Button>
      </div>
      <ActionLines
        effect={props.effect}
        cost={props.cost}
        more={props.more}
        refusedBecause={props.refusedBecause}
        describedBy={describedBy}
        hidden={compact}
      />
    </div>
  );
}
