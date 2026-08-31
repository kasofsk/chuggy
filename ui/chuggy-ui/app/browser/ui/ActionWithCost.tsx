/**
 * A mutation and what answering it does: the button, one fragment of effect
 * with its cost, and at most one more.
 *
 * Total over `actionStates` — ready, busy, refused, and offered-not-at-all —
 * each in the full form the ticket page draws and the compact form a table row
 * has room for. A refusal is visible text and never a `title`, because a reason
 * a reader has to hover for is a reason they will not find.
 */

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
  readonly danger?: boolean;
  readonly variant?: ActionForm;
  readonly onChoose: () => void;
}

export function actionStateOf(props: ActionWithCostProps): ActionState {
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

export function ActionWithCost(props: ActionWithCostProps): ReactNode {
  const state = actionStateOf(props);
  const compact = props.variant === "compact";
  const describedBy = `act-${props.action.toLowerCase()}`;
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
