/**
 * A settings page that is a list, as the People page drew the first: a table
 * edge to edge in a card, under the line that counts it and beside that line
 * the action the list has, and one line where the list was cut or cannot be
 * read.
 *
 * Written once so a page drawn in this frame stands as the People page does
 * without being a copy of it. The sheet is the People page's own, whose table
 * this is: it sets a row for lines read down a column, and stacks the row
 * where the page is narrow, which is why the whole listing is a container.
 */

import { useId } from "react";
import type { ReactNode } from "react";

import type { PanelState } from "../../core/freshness.ts";
import { tenantPeopleTruncated } from "../../core/tenantPeople.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Table } from "../ui/Table.tsx";

import "./tenantPeople.css";

const cardClassName = "bg-surface-1 border-edge rounded-2 min-w-0 border";

export function SettingsListing(props: {
  readonly children: ReactNode;
}): ReactNode {
  return <div className="@container grid min-w-0 gap-5">{props.children}</div>;
}

/** A table under the line that heads it, and beside that line the action the
 * table has. */
export function SettingsListingSection(props: {
  readonly heading: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const labelled = useId();
  return (
    <section aria-labelledby={labelled} className="grid min-w-0 gap-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h2 id={labelled} className="text-md font-medium">
          {props.heading}
        </h2>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

/** The card a listing's table is drawn in, the columns and rows its caller's own. */
export function SettingsListingTable(props: {
  readonly caption: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className={`people-table ${cardClassName}`}>
      <Table caption={props.caption}>{props.children}</Table>
    </div>
  );
}

/** What stands in a cell for a row that holds nothing there. */
export function SettingsListingNone(): ReactNode {
  return (
    <span className="text-ink-3">
      <span aria-hidden="true">—</span>
      <span className="visually-hidden">None</span>
    </span>
  );
}

/** An empty attribute where a cell holds nothing, which is how the stacked
 * row leaves that cell out. */
export function settingsListingNone(empty: boolean): "" | undefined {
  return empty ? "" : undefined;
}

/** The line under a list the plane cut short. */
export function SettingsListingCut(): ReactNode {
  return <Notice tone="parked" inline detail={tenantPeopleTruncated} />;
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
