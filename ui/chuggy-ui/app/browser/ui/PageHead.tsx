/**
 * A page's own head: its title beside the identity that names it, and the row
 * of standing controls under that — the shape a thread page and a lead page
 * both draw before their own body starts, once instead of drawn twice.
 *
 * The identity is drawn through `Identity`, the one primitive that already
 * shortens a session id for a reader and keeps the whole of it on hover.
 */

import type { ReactNode } from "react";

import type { Label } from "../../core/labels.ts";
import { Identity } from "./Identity.tsx";

import "./PageHead.css";

export function PageHead(props: {
  readonly title: string;
  readonly identity: Label;
  readonly children: ReactNode;
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
