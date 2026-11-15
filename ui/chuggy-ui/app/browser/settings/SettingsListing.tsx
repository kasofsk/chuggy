/**
 * A settings page that is a list, as the People page drew the first: a table
 * edge to edge in a card, under the line that counts it and beside that line
 * the action the list has, and one line where the list was cut or cannot be
 * read.
 *
 * Written once so a page drawn in this frame stands as the People page does
 * without being a copy of it. Its table is the primitive's stacked one, drawn
 * to the card's edges, so where the listing is narrow each row is a card of
 * its own.
 */

import { useId } from "react";
import type { ReactNode } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { PanelState } from "../../core/freshness.ts";
import { tenantPeopleTruncated } from "../../core/tenantPeople.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Table } from "../ui/Table.tsx";
import type { TableColumn, TableRow } from "../ui/Table.tsx";

const cardClassName = "bg-surface-1 border-edge rounded-2 min-w-0 border";

export function SettingsListing(props: {
  readonly children: ReactNode;
}): ReactNode {
  return <div className="@container grid min-w-0 gap-5">{props.children}</div>;
}

/** A table under the line that heads it, beside that line the action the
 * table has, and under it the one line saying what the list is where it is
 * not plain from the heading. */
export function SettingsListingSection(props: {
  readonly heading: string;
  readonly about?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const labelled = useId();
  return (
    <section aria-labelledby={labelled} className="grid min-w-0 gap-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <h2 id={labelled} className="text-md font-medium">
            {props.heading}
          </h2>
          {props.about === undefined ? null : (
            <p className="m-0 text-sm text-ink-3">{props.about}</p>
          )}
        </div>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

/** The card a listing's table is drawn in, each row a card of its own on a
 * narrow container. `className` is the caller's sheet's, for its columns. */
export function SettingsListingStacked<Key extends string>(props: {
  readonly caption: string;
  readonly columns: readonly TableColumn<Key>[];
  readonly rows: readonly TableRow<Key>[];
  readonly className?: string;
}): ReactNode {
  return (
    <div
      className={
        props.className === undefined
          ? cardClassName
          : `${props.className} ${cardClassName}`
      }
    >
      <Table
        caption={props.caption}
        stacked={{ columns: props.columns, rows: props.rows, framed: true }}
      />
    </div>
  );
}

/** What stands in a cell for a row that holds nothing there. */
export function SettingsListingNone(): ReactNode {
  const text = useCopyText();
  return (
    <span className="text-ink-3">
      <span aria-hidden="true">—</span>
      <span className="visually-hidden">{text({ id: "settings-none" })}</span>
    </span>
  );
}

/** The line under a list the plane cut short. */
export function SettingsListingCut(): ReactNode {
  const text = useCopyText();
  return <Notice tone="parked" inline detail={text(tenantPeopleTruncated)} />;
}

function SettingsListingLine(props: {
  readonly children: ReactNode;
}): ReactNode {
  return <div className={`${cardClassName} px-4 py-3`}>{props.children}</div>;
}

/** The one line drawn to a reader the list is not answered to. */
export function SettingsListingWithheld(props: {
  readonly line: string;
}): ReactNode {
  return (
    <SettingsListingLine>
      <Notice tone="parked" inline detail={props.line} />
    </SettingsListingLine>
  );
}

/** A list that is not read: who it is answered to where it is absent, and the
 * read's own line otherwise. */
export function SettingsListingUnread<T>(props: {
  readonly state: PanelState<T>;
  readonly withheld: string;
}): ReactNode {
  if (props.state.state === "Absent")
    return <SettingsListingWithheld line={props.withheld} />;
  return (
    <SettingsListingLine>
      <PanelUnready state={props.state} />
    </SettingsListingLine>
  );
}
