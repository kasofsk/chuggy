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
  const look = epicStatusLook(props.status);
  return <Pill tone={look.tone}>{look.word}</Pill>;
}

/** How much of the epic is done, as a bar and in words. */
export function EpicProgress(props: {
  readonly progress: EpicSummaryResponse["progress"];
}): ReactNode {
  return (
    <>
      <progress
        className="epic-progress"
        aria-label="Progress"
        max={Math.max(props.progress.total, 1)}
        value={props.progress.done}
      />
      <span className="text-ink-3 text-sm">
        {epicProgressLine(props.progress)}
      </span>
    </>
  );
}

function EpicRow(props: {
  readonly partition: PartitionIdentity;
  readonly epic: EpicSummaryResponse;
}): ReactNode {
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
          <Pill tone="retired">Archived</Pill>
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
        <EmptyState label="No epics" />
      ) : (
        <ul className="epic-list" aria-label="Epics">
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
            Show more
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
  const { query, onQuery } = props;
  const [typed, setTyped] = useEpicsTyped(query, onQuery);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        label="Search epics"
        placeholder="Search titles or #number…"
        value={typed}
        onChange={setTyped}
      />
      <Picker
        label="Visibility"
        value={query.visibility ?? "Active"}
        options={epicVisibilityChoices.map((choice) => ({ ...choice }))}
        onChoose={(visibility) => {
          onQuery(epicsQueryWith(query, { visibility }));
        }}
      />
      <Picker
        label="Sort"
        value={query.sort ?? "newest"}
        options={epicSortChoices.map((choice) => ({ ...choice }))}
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
  const navigate = useNavigate();
  return (
    <Panel title="New epic" collapsible={{ open: false }}>
      <EpicFormPanel
        partition={props.partition}
        held={undefined}
        submit="Create epic"
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
  const partition = useParams({ from: "/$tenant/$project" });
  const writing = !projectAbilityRefused(
    useProjectAbilities(partition),
    "writeEpic",
  );
  return (
    <section className="grid min-w-0 gap-3" aria-label="Epics" data-fills-width>
      <ScreenTitle>Epics</ScreenTitle>
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
