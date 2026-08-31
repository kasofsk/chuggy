/**
 * A status word, one detail line and at most one more: where the ticket is, a
 * stream that is not live, a read that failed.
 *
 * Total over `noticeTones` × block or inline. The block form carries a rail
 * and a wash and is what a reader is meant to stop on; the inline form is one
 * line inside a panel, for a read that is loading, absent or failed.
 */

import type { ReactNode } from "react";

import "./Notice.css";

export const noticeTones = ["info", "live", "parked", "danger"] as const;

export type NoticeTone = (typeof noticeTones)[number];

export function Notice(props: {
  readonly tone: NoticeTone;
  readonly heading?: string;
  readonly detail?: string;
  readonly more?: string;
  readonly inline?: boolean;
  readonly role?: "status" | "alert";
  readonly children?: ReactNode;
}): ReactNode {
  const toned = `notice notice-${props.tone}`;
  if (props.inline === true)
    return (
      <p className={`${toned} notice-inline`} role={props.role}>
        {props.detail}
        {props.children}
      </p>
    );
  return (
    <div className={toned} role={props.role}>
      {props.heading === undefined ? null : (
        <strong className="notice-head">{props.heading}</strong>
      )}
      {props.detail === undefined ? null : (
        <p className="notice-detail">{props.detail}</p>
      )}
      {props.more === undefined ? null : (
        <p className="notice-more">{props.more}</p>
      )}
      {props.children}
    </div>
  );
}
