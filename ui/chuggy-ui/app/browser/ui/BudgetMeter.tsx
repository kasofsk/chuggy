/**
 * One budget: what it has spent, what is left, and the unit it is charged in.
 *
 * Total over `meterStates` — a budget with room, one exhausted, one counted
 * past its own limit, one whose limit the wire does not carry, and one the
 * ticket was not authored to pay from. A count the page derived says so, so a
 * floor over a short page is never read as the machine's own figure. The cells
 * are elements rather than a width, because the served policy admits no inline
 * style and a width from script is exactly that.
 */

import type { ReactNode } from "react";

import type { Account } from "../../core/ticketAccounts.ts";

import "./BudgetMeter.css";

export const meterStates = [
  "room",
  "exhausted",
  "over",
  "unbounded",
  "none",
] as const;

export type MeterState = (typeof meterStates)[number];

/** Above this a budget is a bar rather than a cell per unit a reader can count. */
export const meterCellsMax = 12;

export function meterStateOf(account: Account): MeterState {
  switch (account.policy) {
    case "NotBudgeted":
      return "none";
    case "LimitNotOnWire":
      return "unbounded";
    case "Budgeted":
      if (account.max !== undefined && account.spent > account.max)
        return "over";
      return account.left === 0 ? "exhausted" : "room";
  }
}

/** The figure a reader scans, which is a count against a limit wherever there is one. */
export function meterFigureText(account: Account): string {
  const spent = String(account.spent);
  if (account.policy === "NotBudgeted") return "Not budgeted";
  if (account.policy === "LimitNotOnWire")
    return `${spent}+ used · limit unknown`;
  const max = String(account.max ?? 0);
  const state = meterStateOf(account);
  if (state === "over") return `${spent}/${max} used · Count is wrong`;
  if (state === "exhausted") return `${spent}/${max} used · Exhausted`;
  return `${spent}/${max} used · ${String(account.left ?? 0)} left`;
}

function meterCells(account: Account): ReactNode {
  const max = account.max ?? 0;
  if (max > meterCellsMax)
    return <meter className="meter-native" value={account.spent} max={max} />;
  return (
    <div className="meter-cells" aria-hidden="true">
      {Array.from({ length: max }, (_cell, index) => (
        <i
          key={index}
          className={
            index < account.spent
              ? "meter-cell meter-cell-spent"
              : "meter-cell meter-cell-left"
          }
        />
      ))}
    </div>
  );
}

function MeterTrack(props: { readonly account: Account }): ReactNode {
  switch (props.account.policy) {
    case "NotBudgeted":
      return null;
    case "LimitNotOnWire":
      return <div className="meter-bar-unbounded" aria-hidden="true" />;
    case "Budgeted":
      return meterCells(props.account);
  }
}

export function BudgetMeter(props: {
  readonly name: string;
  readonly account: Account;
  readonly how?: string;
  readonly action?: ReactNode;
}): ReactNode {
  const account = props.account;
  const figure = meterFigureText(account);
  return (
    <div
      className={`meter meter-${meterStateOf(account)}`}
      role="group"
      aria-label={`${props.name} ${figure}`}
    >
      <p className="meter-line">
        <span className="meter-name">{props.name}</span>
        <span className="meter-figure num">{figure}</span>
      </p>
      <MeterTrack account={account} />
      {props.how === undefined ? null : (
        <p className="meter-how">{props.how}</p>
      )}
      {account.provenance === "Derived" ? (
        <p className="meter-how meter-derived">Counted on this page</p>
      ) : null}
      {props.action === undefined ? null : (
        <div className="meter-action">{props.action}</div>
      )}
    </div>
  );
}
