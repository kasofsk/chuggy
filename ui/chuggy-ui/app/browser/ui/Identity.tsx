/**
 * An identifier short enough to sit beside its name, with the full value on
 * hover — the reading `core/labels.ts` already gives configurations, commits,
 * images and workers.
 *
 * Total over `identityForms`: inline beside a label, or a block a reader
 * selects whole. The full value is always the `title`, because a shortened
 * identity a reader cannot recover is one they have to go elsewhere for.
 */

import type { ReactNode } from "react";

import type { Label } from "../../core/labels.ts";

import "./Identity.css";

export const identityForms = ["inline", "block"] as const;

export type IdentityForm = (typeof identityForms)[number];

export function Identity(props: {
  readonly label: Label;
  readonly block?: boolean;
}): ReactNode {
  const form = props.block === true ? "identity identity-block" : "identity";
  return (
    <code className={form} title={props.label.title}>
      {props.label.text}
    </code>
  );
}
