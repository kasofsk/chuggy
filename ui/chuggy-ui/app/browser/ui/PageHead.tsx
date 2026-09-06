/**
 * A page's own head: its title beside the identity it stands for, drawn
 * through `Identity`, and a row of standing controls under them — a page's
 * state pills and whatever door acts on it.
 *
 * Total over a `children` row present or empty. What sits below the head — a
 * page's own fields — is not this primitive's: a title, an identity and a row
 * of controls are the whole of what a thread's head and a lead's head draw
 * alike.
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
