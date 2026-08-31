/**
 * Key–value pairs in a two-column list: a brief, an authoring, a configuration
 * head, a run's figures.
 *
 * Total over `fieldsVariants` × a value present or absent. It is a real
 * definition list, so the pairing is in the markup a reader's assistive
 * technology walks rather than only in the grid; an absent value is drawn in
 * the retired ink and says what it is rather than being left blank.
 */

import type { ReactNode } from "react";

import "./Fields.css";

export const fieldsVariants = ["stacked", "inline"] as const;

export type FieldsVariant = (typeof fieldsVariants)[number];

export function Fields(props: {
  readonly variant?: FieldsVariant;
  readonly children: ReactNode;
}): ReactNode {
  const inline = props.variant === "inline" ? " fields-inline" : "";
  return <dl className={`fields${inline}`}>{props.children}</dl>;
}

export function Field(props: {
  readonly name: string;
  readonly absent?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="field">
      <dt>{props.name}</dt>
      <dd className={props.absent === true ? "field-absent" : undefined}>
        {props.children}
      </dd>
    </div>
  );
}
