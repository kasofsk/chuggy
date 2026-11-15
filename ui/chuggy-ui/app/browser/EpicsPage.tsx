/**
 * A project's epics: a search, a visibility filter and a sort, each the
 * address's so a link holds the view, and one row an epic with a bar of where
 * its tickets stand and what the bar says beside it. Each page of rows is read
 * under its own cursor into the one list, and "Show more" adds the next, so a
 * page already read is not read again.
 */

import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { EpicSummaryResponse } from "../../../../src/contract/responses.ts";
import { useCopyText } from "../copy/CopyProvider.tsx";
import {
  epicSortChoices,
  epicVisibilityChoices,
  epicsAskOf,
  epicsQuery,
  epicsQueryWith,
  epicsSearchWaitMs,
} from "../core/epics.ts";
import type { EpicsQuery } from "../core/epics.ts";
import { usePanelState } from "./api.ts";
import { PanelUnready } from "./DataPanel.tsx";
import {
  ListControls,
  ListSearch,
  listFilterGlyph,
  listSortGlyph,
} from "./ui/ListControls.tsx";
import { EpicProgressRow } from "./epic/EpicProgress.tsx";
import { ScreenTitle } from "./shell/slots.tsx";
import { Button } from "./ui/Button.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Picker } from "./ui/Picker.tsx";
import { Pill } from "./ui/Pill.tsx";

import "./Epic.css";
import "./ProjectTable.css";

/** A row in the ticket list's own classes, so the two lists are drawn as one:
 * the title over the number and the summary, and the bar where a ticket's row
 * holds its state. */
function EpicRow(props: {
  readonly partition: PartitionIdentity;
  readonly epic: EpicSummaryResponse;
}): ReactNode {
  const text = useCopyText();
  const { epic } = props;
  const params = { ...props.partition, epic: String(epic.number) };
  return (
    <li className="ticket-list-item" data-epic={epic.number}>
      <article className="ticket-list-row">
        <div className="ticket-list-head">
          <h3 className="ticket-list-title">
            <Link to="/$tenant/$project/epics/$epic" params={params}>
              {epic.title}
            </Link>
          </h3>
          <div className="ticket-list-info">
            <span className="ticket-list-number">
              <Link to="/$tenant/$project/epics/$epic" params={params}>
                {epic.number}
              </Link>
            </span>
            {epic.summary === undefined ? null : (
              <span className="ticket-list-meta">
                <span title={epic.summary}>{epic.summary}</span>
              </span>
            )}
          </div>
        </div>
        <div className="ticket-list-foot">
          <EpicProgressRow progress={epic.progress} />
          {epic.visibility === "Archived" ? (
            <span className="ticket-list-foot-standing">
              <Pill tone="retired">
                {text({ id: "epics-visibility-archived" })}
              </Pill>
            </span>
          ) : null}
        </div>
      </article>
    </li>
  );
}

/** One page's rows, read under its own cursor; the list it stands in draws
 * what a page not yet read says. */
function EpicRowsPage(props: {
  readonly partition: PartitionIdentity;
  readonly query: EpicsQuery;
  readonly after: number | undefined;
}): ReactNode {
  const state = usePanelState(
    epicsQuery(props.partition, {
      ...epicsAskOf(props.query),
      after: props.after,
    }),
  );
  if (state.state !== "Ready") return null;
  return state.value.epics.map((epic) => (
    <EpicRow key={epic.number} partition={props.partition} epic={epic} />
  ));
}

/** Every page read so far as one list, and under it the newest page's
 * standing: what it says while unread, or the way to the next. */
function EpicRows(props: {
  readonly partition: PartitionIdentity;
  readonly query: EpicsQuery;
}): ReactNode {
  const text = useCopyText();
  const [afters, setAfters] = useState<readonly (number | undefined)[]>([
    undefined,
  ]);
  const newest = usePanelState(
    epicsQuery(props.partition, {
      ...epicsAskOf(props.query),
      after: afters.at(-1),
    }),
  );
  const first = afters.length === 1;
  if (first && newest.state !== "Ready") return <PanelUnready state={newest} />;
  if (first && newest.state === "Ready" && newest.value.epics.length === 0)
    return <EmptyState label={text({ id: "epics-none" })} />;
  const nextAfter =
    newest.state === "Ready" ? newest.value.nextAfter : undefined;
  return (
    <>
      <ul className="ticket-list" aria-label={text({ id: "epics-title" })}>
        {afters.map((after) => (
          <EpicRowsPage
            key={String(after)}
            partition={props.partition}
            query={props.query}
            after={after}
          />
        ))}
      </ul>
      {newest.state === "Ready" ? null : <PanelUnready state={newest} />}
      {nextAfter === undefined ? null : (
        <div className="ticket-list-more">
          <Button
            onClick={() => {
              setAfters([...afters, nextAfter]);
            }}
          >
            {text({ id: "epics-show-more" })}
          </Button>
        </div>
      )}
    </>
  );
}

function epicsTypedSearch(typed: string): string | undefined {
  return typed.trim() === "" ? undefined : typed.trim();
}

/**
 * What is typed, and the address it is written into once it has stood. A
 * search the address moves to by any other way, a link or going back,
 * replaces what is typed.
 */
function useEpicsTyped(
  query: EpicsQuery,
  onQuery: (query: EpicsQuery) => void,
): readonly [string, (typed: string) => void] {
  const [typed, setTyped] = useState(query.q ?? "");
  const [addressed, setAddressed] = useState(query.q);
  if (addressed !== query.q) {
    setAddressed(query.q);
    if (epicsTypedSearch(typed) !== query.q) setTyped(query.q ?? "");
  }
  useEffect(() => {
    const q = epicsTypedSearch(typed);
    if (q === query.q) return undefined;
    const waiting = setTimeout(() => {
      onQuery(epicsQueryWith(query, { q }));
    }, epicsSearchWaitMs);
    return () => {
      clearTimeout(waiting);
    };
  }, [typed, query, onQuery]);
  return [typed, setTyped];
}

function EpicsControls(props: {
  readonly query: EpicsQuery;
  readonly onQuery: (query: EpicsQuery) => void;
}): ReactNode {
  const text = useCopyText();
  const { query, onQuery } = props;
  const [typed, setTyped] = useEpicsTyped(query, onQuery);
  return (
    <ListControls>
      <ListSearch
        label={text({ id: "epics-search" })}
        placeholder={text({ id: "epics-search-placeholder" })}
        search={typed}
        onSearch={setTyped}
      />
      <Picker
        label={text({ id: "epics-sort" })}
        iconOnly
        glyph={listSortGlyph}
        value={query.sort ?? "newest"}
        options={epicSortChoices.map((choice) => ({
          value: choice.value,
          text: text(choice.text),
        }))}
        onChoose={(sort) => {
          onQuery(epicsQueryWith(query, { sort }));
        }}
        align="end"
      />
      <Picker
        label={text({ id: "epics-visibility" })}
        iconOnly
        glyph={listFilterGlyph}
        value={query.visibility ?? "Active"}
        options={epicVisibilityChoices.map((choice) => ({
          value: choice.value,
          text: text(choice.text),
        }))}
        onChoose={(visibility) => {
          onQuery(epicsQueryWith(query, { visibility }));
        }}
        align="end"
      />
    </ListControls>
  );
}

export function EpicsPage(props: {
  readonly query: EpicsQuery;
  readonly onQuery: (query: EpicsQuery) => void;
}): ReactNode {
  const text = useCopyText();
  const partition = useParams({ from: "/$tenant/$project" });
  return (
    <section
      className="epic-list-page"
      aria-label={text({ id: "epics-title" })}
      data-fills-width
    >
      <ScreenTitle>{text({ id: "epics-title" })}</ScreenTitle>
      <EpicsControls query={props.query} onQuery={props.onQuery} />
      <EpicRows
        key={JSON.stringify(props.query)}
        partition={partition}
        query={props.query}
      />
    </section>
  );
}
