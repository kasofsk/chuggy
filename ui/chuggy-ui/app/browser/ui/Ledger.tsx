/**
 * A journal drawn in its own structure: groups with a standing, blocks with an
 * eyebrow, and rows on hairline rules carrying a label, an identity, a status,
 * a window, a spend and a note.
 *
 * Total over a group current or superseded × open or closed, and over a row
 * plain or ghosted × changed or not × expandable or not. Every figure arrives
 * already formatted, so a row does no arithmetic and no two rows round the same
 * quantity differently. It is four components rather than one because the
 * function-length cap is what keeps each of them readable.
 */

import type { ReactNode } from "react";

import type { Figure as FigureValue, Spend } from "../../core/figures.ts";
import type { Label } from "../../core/labels.ts";
import type { Tone } from "../../core/tones.ts";
import { Button } from "./Button.tsx";
import { Figure } from "./Figure.tsx";
import { Identity } from "./Identity.tsx";
import { Notice } from "./Notice.tsx";
import { Pill } from "./Pill.tsx";

import "./Ledger.css";

export const ledgerStandings = ["Current", "Superseded"] as const;

export type LedgerStanding = (typeof ledgerStandings)[number];

export interface LedgerMark {
  readonly tone: Tone;
  readonly text: string;
}

export function Ledger(props: {
  readonly truncated?: string | undefined;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="ledger">
      {props.truncated === undefined ? null : (
        <Notice tone="parked" inline detail={props.truncated} />
      )}
      {props.children}
    </div>
  );
}

export function LedgerGroup(props: {
  readonly title: string;
  readonly standing: LedgerStanding;
  readonly summary: string;
  readonly rollup?: ReactNode | undefined;
  readonly open: boolean;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <details
      className={`ledger-group ledger-group-${props.standing.toLowerCase()}`}
      open={props.open}
    >
      <summary>
        <span className="ledger-group-head">
          <h3>{props.title}</h3>
          <Pill tone={props.standing === "Current" ? "live" : "retired"}>
            {props.standing}
          </Pill>
          <span className="ledger-group-summary">{props.summary}</span>
        </span>
        {props.rollup === undefined ? null : (
          <span className="ledger-group-rollup">{props.rollup}</span>
        )}
      </summary>
      {props.children}
    </details>
  );
}

export function LedgerBlock(props: {
  readonly eyebrow?: string | undefined;
  readonly pill?: LedgerMark | undefined;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="ledger-block">
      {props.eyebrow === undefined ? null : (
        <p className="ledger-eyebrow">
          <span className="eyebrow">{props.eyebrow}</span>
          {props.pill === undefined ? null : (
            <Pill tone={props.pill.tone}>{props.pill.text}</Pill>
          )}
        </p>
      )}
      <ul className="ledger-rows">{props.children}</ul>
    </div>
  );
}

function ledgerRowClassName(ghost: boolean, changed: boolean): string {
  const ghosted = ghost ? " ledger-row-ghost" : "";
  return `ledger-row${ghosted}${changed ? " ledger-row-changed" : ""}`;
}

export interface LedgerRowProps {
  readonly label: string;
  readonly identity?: Label | undefined;
  readonly pill: LedgerMark;
  readonly when?: FigureValue | undefined;
  readonly spent?: Spend | undefined;
  readonly note?: ReactNode | undefined;
  readonly ghost?: boolean;
  readonly changed?: boolean;
  readonly expand?: {
    readonly open: boolean;
    readonly onToggle: () => void;
    readonly children: ReactNode;
  };
}

function LedgerRowExpand(props: {
  readonly expand: NonNullable<LedgerRowProps["expand"]>;
}): ReactNode {
  return (
    <Button
      variant="quiet"
      size="sm"
      expanded={props.expand.open}
      onClick={props.expand.onToggle}
    >
      {props.expand.open ? "Hide" : "Details"}
    </Button>
  );
}

export function LedgerRow(props: LedgerRowProps): ReactNode {
  const expand = props.expand;
  return (
    <li
      className={ledgerRowClassName(
        props.ghost === true,
        props.changed === true,
      )}
    >
      <span className="ledger-label">{props.label}</span>
      <span className="ledger-identity">
        {props.identity === undefined ? null : (
          <Identity label={props.identity} />
        )}
      </span>
      <span className="ledger-pill">
        <Pill tone={props.pill.tone}>{props.pill.text}</Pill>
      </span>
      <span className="ledger-when">
        {props.when === undefined ? null : <Figure figure={props.when} />}
      </span>
      <span className="ledger-spent">
        {props.spent === undefined ? null : (
          <>
            <Figure figure={props.spent.cost} />
            <i className="fig-sep" aria-hidden="true">
              ·
            </i>
            <Figure figure={props.spent.tokens} />
          </>
        )}
      </span>
      <span className="ledger-note">{props.note}</span>
      {expand === undefined ? null : <LedgerRowExpand expand={expand} />}
      {expand?.open === true ? (
        <div className="ledger-detail">{expand.children}</div>
      ) : null}
    </li>
  );
}
