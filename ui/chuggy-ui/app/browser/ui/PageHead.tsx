/**
 * A page's own line: what it is, the identity beside it, and the row of
 * standing pills and controls under that — the shape `ThreadHead` and
 * `LeadHead` both draw, so the identity is always read through `Identity`
 * rather than hand-rolled at each call site.
 */

import type { ReactNode } from "react";

import type { Label } from "../../core/labels.ts";
import { Identity } from "./Identity.tsx";

import "./PageHead.css";

export function PageHead(props: {
  readonly title: ReactNode;
  readonly identity: Label;
  readonly children?: ReactNode;
}): ReactNode {
  return (
    <div className="page-head">
      <div className="page-head-title">
        <h1>{props.title}</h1>
        <Identity label={props.identity} />
      </div>
      <div className="page-head-controls">{props.children}</div>
    </div>
  );
}
