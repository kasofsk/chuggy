/**
 * A project's epics: a search, a visibility filter and a sort, each the
 * address's so a link holds the view, and one row an epic with its status and
 * how much of it is done. Each page of rows is read under its own cursor, and
 * "Show more" mounts the next, so a page already read is not read again.
 */

import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { EpicSummaryResponse } from "../../../../src/contract/responses.ts";
import { useCopyText } from "../copy/CopyProvider.tsx";
import { projectAbilityRefused } from "../core/projectAbilities.ts";
import {
  epicProgressLine,
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
import { EpicFormPanel } from "./EpicForm.tsx";
import { useProjectAbilities } from "./projectAbilities.tsx";
import { ScreenTitle } from "./shell/slots.tsx";
import { Button } from "./ui/Button.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Input } from "./ui/Input.tsx";
import { Panel } from "./ui/Panel.tsx";
import { Picker } from "./ui/Picker.tsx";
import { Pill } from "./ui/Pill.tsx";

import "./Epic.css";

export function EpicStatusPill(props: {
  readonly status: EpicSummaryResponse["status"];
}): ReactNode {
  const text = useCopyText();
  const look = epicStatusLook(props.status);
  return <Pill tone={look.tone}>{text(look.word)}</Pill>;
}

/** How much of the epic is done, as a bar and in words. */
export function EpicProgress(props: {
  readonly progress: EpicSummaryResponse["progress"];
}): ReactNode {
  const text = useCopyText();
  return (
    <>
      <progress
        className="epic-progress"
        aria-label={text({ id: "epics-progress-label" })}
        max={Math.max(props.progress.total, 1)}
        value={props.progress.done}
      />
      <span className="text-ink-3 text-sm">
        {text(epicProgressLine(props.progress))}
      </span>
    </>
  );
}

function EpicRow(props: {
  readonly partition: PartitionIdentity;
  readonly epic: EpicSummaryResponse;
}): ReactNode {
  const text = useCopyText();
  const { epic } = props;
  return (
    <li className="epic-row" data-epic={epic.number}>
      <div className="epic-row-head">
        <h3 className="epic-row-title">
          <Link
            to="/$tenant/$project/epics/$epic"
            params={{ ...props.partition, epic: String(epic.number) }}
          >
            {epic.title}
          </Link>
        </h3>
        <span className="text-ink-3 text-sm">{`#${String(epic.number)}`}</span>
        <EpicStatusPill status={epic.status} />
        {epic.visibility === "Archived" ? (
          <Pill tone="retired">
            {text({ id: "epics-visibility-archived" })}
          </Pill>
        ) : null}
      </div>
      {epic.summary === undefined ? null : (
        <p className="text-ink-2 text-sm">{epic.summary}</p>
      )}
      <EpicProgress progress={epic.progress} />
    </li>
  );
}

/** One page of the rows, and under it the next once it is asked for. */
function EpicRowsPage(props: {
  readonly partition: PartitionIdentity;
  readonly query: EpicsQuery;
  readonly after: number | undefined;
  readonly first: boolean;
}): ReactNode {
  const text = useCopyText();
  const [more, setMore] = useState(false);
  const state = usePanelState(
    epicsQuery(props.partition, {
      ...epicsAskOf(props.query),
      after: props.after,
    }),
  );
  if (state.state !== "Ready") return <PanelUnready state={state} />;
  const { epics, nextAfter } = state.value;
  return (
    <>
      {epics.length === 0 && props.first ? (
        <EmptyState label={text({ id: "epics-none" })} />
      ) : (
        <ul className="epic-list" aria-label={text({ id: "epics-title" })}>
          {epics.map((epic) => (
            <EpicRow
              key={epic.number}
              partition={props.partition}
              epic={epic}
            />
          ))}
        </ul>
      )}
      {nextAfter === undefined ? null : more ? (
        <EpicRowsPage
          partition={props.partition}
          query={props.query}
          after={nextAfter}
          first={false}
        />
      ) : (
        <div>
          <Button
            onClick={() => {
              setMore(true);
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
    <div className="flex flex-wrap items-center gap-2">
      <Input
        label={text({ id: "epics-search" })}
        placeholder={text({ id: "epics-search-placeholder" })}
        value={typed}
        onChange={setTyped}
      />
      <Picker
        label={text({ id: "epics-visibility" })}
        value={query.visibility ?? "Active"}
        options={epicVisibilityChoices.map((choice) => ({
          value: choice.value,
          text: text(choice.text),
        }))}
        onChoose={(visibility) => {
          onQuery(epicsQueryWith(query, { visibility }));
        }}
      />
      <Picker
        label={text({ id: "epics-sort" })}
        value={query.sort ?? "newest"}
        options={epicSortChoices.map((choice) => ({
          value: choice.value,
          text: text(choice.text),
        }))}
        onChoose={(sort) => {
          onQuery(epicsQueryWith(query, { sort }));
        }}
      />
    </div>
  );
}

function EpicCreation(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const text = useCopyText();
  const navigate = useNavigate();
  return (
    <Panel title={text({ id: "epics-new" })} collapsible={{ open: false }}>
      <EpicFormPanel
        partition={props.partition}
        held={undefined}
        submit={text({ id: "epics-create" })}
        onSaved={(saved) => {
          void navigate({
            to: "/$tenant/$project/epics/$epic",
            params: { ...props.partition, epic: String(saved.epic) },
          });
        }}
      />
    </Panel>
  );
}

export function EpicsPage(props: {
  readonly query: EpicsQuery;
  readonly onQuery: (query: EpicsQuery) => void;
}): ReactNode {
  const text = useCopyText();
  const partition = useParams({ from: "/$tenant/$project" });
  const writing = !projectAbilityRefused(
    useProjectAbilities(partition),
    "writeEpic",
  );
  return (
    <section
      className="grid min-w-0 gap-3"
      aria-label={text({ id: "epics-title" })}
      data-fills-width
    >
      <ScreenTitle>{text({ id: "epics-title" })}</ScreenTitle>
      <EpicsControls query={props.query} onQuery={props.onQuery} />
      {writing ? <EpicCreation partition={partition} /> : null}
      <EpicRowsPage
        key={JSON.stringify(props.query)}
        partition={partition}
        query={props.query}
        after={undefined}
        first
      />
    </section>
  );
}
