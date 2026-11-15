/**
 * A project's epics: a search, a visibility filter and a sort, each the
 * address's so a link holds the view, and one row an epic: its title, its
 * progress bar with what the bar says beside it and its summary, and its
 * status. Each page of rows is read under its own cursor into the one list,
 * and "Show more" adds the next, so a page already read is not read again.
 */

import { useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { EpicSummaryResponse } from "../../../../src/contract/responses.ts";
import { useCopyText } from "../copy/CopyProvider.tsx";
import {
  epicSortChoices,
  epicStatusLook,
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
import { EmptyState } from "./ui/EmptyState.tsx";
import { Picker } from "./ui/Picker.tsx";
import { RecordList, RecordRow, RecordRowSkeleton } from "./ui/RecordList.tsx";
import { StatusBadge } from "./ui/StatusBadge.tsx";

import "./Epic.css";

/** The status an epic stands at, and Archived beside it where it is. */
function EpicRowStatus(props: {
  readonly epic: EpicSummaryResponse;
}): ReactNode {
  const text = useCopyText();
  const look = epicStatusLook(props.epic.status);
  return (
    <>
      <StatusBadge tone={look.tone} size="small">
        {text(look.word)}
      </StatusBadge>
      {props.epic.visibility === "Archived" ? (
        <StatusBadge tone="retired" size="small">
          {text({ id: "epics-visibility-archived" })}
        </StatusBadge>
      ) : null}
    </>
  );
}

function EpicRow(props: {
  readonly partition: PartitionIdentity;
  readonly epic: EpicSummaryResponse;
}): ReactNode {
  const { epic } = props;
  return (
    <RecordRow
      title={epic.title}
      link={{
        to: "/$tenant/$project/epics/$epic",
        params: { ...props.partition, epic: String(epic.number) },
      }}
      level={3}
      meta={
        <>
          <EpicProgressRow progress={epic.progress} />
          {epic.summary === undefined ? null : (
            <span className="epic-list-summary" title={epic.summary}>
              {epic.summary}
            </span>
          )}
        </>
      }
      trailing={<EpicRowStatus epic={epic} />}
    />
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

const epicsSkeletonRowsCount = 3;

/** Rows standing where a page's rows will be, until it is read. */
function EpicRowsSkeleton(): ReactNode {
  return Array.from({ length: epicsSkeletonRowsCount }, (_, index) => (
    <RecordRowSkeleton key={index} />
  ));
}

/** Every page read so far as one list: the newest, while it is read, as
 * skeleton rows at the list's end, a newest that failed under the list, and
 * the way to the next once it is read. */
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
  const pending = newest.state === "Pending";
  if (first && !pending && newest.state !== "Ready")
    return <PanelUnready state={newest} />;
  if (first && newest.state === "Ready" && newest.value.epics.length === 0)
    return <EmptyState label={text({ id: "epics-none" })} />;
  const nextAfter =
    newest.state === "Ready" ? newest.value.nextAfter : undefined;
  return (
    <>
      <RecordList
        label={text({
          id: first && pending ? "panel-loading" : "epics-title",
        })}
        more={
          nextAfter === undefined
            ? undefined
            : {
                label: text({ id: "epics-show-more" }),
                onMore: () => {
                  setAfters([...afters, nextAfter]);
                },
              }
        }
      >
        {afters.map((after) => (
          <EpicRowsPage
            key={String(after)}
            partition={props.partition}
            query={props.query}
            after={after}
          />
        ))}
        {pending ? <EpicRowsSkeleton /> : null}
      </RecordList>
      {pending || newest.state === "Ready" ? null : (
        <PanelUnready state={newest} />
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
