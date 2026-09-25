/**
 * A journal drawn in its own structure: groups with a standing, blocks with an
 * eyebrow, and rows on hairline rules carrying a label, an identity, a status,
 * a window, a spend and a note.
 *
 * Total over a group current or superseded × open or closed, and over a row
 * plain or ghosted × changed or not × any number of expanders, which share the
 * one detail area beneath it. Every figure arrives
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

function ledgerRowClassName(
  ghost: boolean,
  changed: boolean,
  superseded: boolean,
): string {
  const ghosted = ghost ? " ledger-row-ghost" : "";
  const superseding = superseded ? " ledger-row-superseded" : "";
  return `ledger-row${ghosted}${changed ? " ledger-row-changed" : ""}${superseding}`;
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
  /** A generation an evaluator's own resume replaced, drawn dimmed beneath
   * the one that stands now. */
  readonly superseded?: boolean;
  /** Drawn in order, the last at the row's edge; the first open one fills the
   * detail area, so a caller keeps at most one open. */
  readonly expands?: readonly LedgerRowExpand[];
}

export interface LedgerRowExpand {
  readonly label: string;
  /** What the button says while its detail is open. */
  readonly hide: string;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
}

function LedgerRowExpands(props: {
  readonly expands: readonly LedgerRowExpand[];
}): ReactNode {
  return (
    <span className="ledger-expands">
      {props.expands.map((expand) => (
        <Button
          key={expand.label}
          variant="quiet"
          size="sm"
          expanded={expand.open}
          onClick={expand.onToggle}
        >
          {expand.open ? expand.hide : expand.label}
        </Button>
      ))}
    </span>
  );
}

export function LedgerRow(props: LedgerRowProps): ReactNode {
  const expands = props.expands ?? [];
  const opened = expands.find((expand) => expand.open);
  return (
    <li
      className={ledgerRowClassName(
        props.ghost === true,
        props.changed === true,
        props.superseded === true,
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
      {expands.length === 0 ? null : <LedgerRowExpands expands={expands} />}
      {opened === undefined ? null : (
        <div className="ledger-detail">{opened.children}</div>
      )}
    </li>
  );
}
