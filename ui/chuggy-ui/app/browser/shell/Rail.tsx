/**
 * The console's navigation: the brand, the sections `shellRailSections`
 * derived, and the account controls at the foot.
 *
 * It draws a heading, a label, a dot and a count and asks what none of them
 * is. A listing that has not answered draws its section with no entries rather
 * than an error, because the rail is beside every screen and a read that failed
 * belongs to the screen that needed it.
 */

import { Link, useNavigate } from "@tanstack/react-router";
import { Separator } from "radix-ui";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ThreadsResponse } from "../../../../../src/contract/responses.ts";
import { apiProjectInventoryAll, apiThreads } from "../../core/apiRoutes.ts";
import { inboxCountLabel } from "../../core/inboxList.ts";
import { lastProjectWrite } from "../../core/lastProject.ts";
import { projectListReread } from "../../core/projectQueryKeys.ts";
import { shellRailSections } from "../../core/shellRail.ts";
import type {
  RailEntry,
  RailSection,
  RailStanding,
} from "../../core/shellRail.ts";
import { sessionStateTone } from "../../core/tones.ts";
import type { Tone } from "../../core/tones.ts";
import { usePanelInventory, usePanelList } from "../api.ts";
import { Footer } from "../Footer.tsx";
import { useInboxRows } from "../Inbox.tsx";
import { useLead } from "../LeadPage.tsx";
import { persistentStore } from "../ports.ts";
import { useSessionHolder } from "../session.tsx";
import {
  themeChoiceApply,
  themeChoiceRead,
  themeChoiceWrite,
  themeChoices,
} from "../theme.ts";
import type { ThemeChoice } from "../theme.ts";
import { threadsListName } from "../ThreadsPage.tsx";
import { Button } from "../ui/Button.tsx";
import { Identity } from "../ui/Identity.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Picker } from "../ui/Picker.tsx";
import { ToggleGroup } from "../ui/ToggleGroup.tsx";

/** The fill a standing's dot takes, total over the roster so a tone the wire
 * grows stops compiling rather than drawing nothing. */
const railDotFills: Readonly<Record<Tone, string>> = {
  pass: "bg-tone-pass",
  fail: "bg-tone-fail",
  live: "bg-tone-live",
  queued: "bg-tone-queued",
  parked: "bg-tone-parked",
  retired: "bg-tone-retired",
  neutral: "bg-ink-3",
};

function RailDot(props: { readonly standing: RailStanding }): ReactNode {
  return (
    <>
      <i
        aria-hidden="true"
        className={`size-2 shrink-0 rounded-circle ${railDotFills[props.standing.tone]}`}
      />
      <span className="visually-hidden">{props.standing.word}</span>
    </>
  );
}

function RailEntryDrawn(props: {
  readonly entry: RailEntry;
  readonly onNavigate: (() => void) | undefined;
}): ReactNode {
  const entry = props.entry;
  return (
    <li>
      <Link
        to={entry.to}
        params={entry.params}
        onClick={props.onNavigate}
        className="flex items-center gap-2 rounded-2 px-3 py-2 text-md text-ink-2 no-underline"
        activeProps={{ className: "bg-surface-2 text-ink-1" }}
      >
        {entry.standing === undefined ? null : (
          <RailDot standing={entry.standing} />
        )}
        <span className="min-w-0 flex-1 truncate">
          {entry.mine === false ? (
            <Identity label={{ text: entry.label, title: entry.label }} />
          ) : (
            entry.label
          )}
        </span>
        {entry.count === undefined ? null : (
          <span className="text-xs text-ink-3 tabular-nums">{entry.count}</span>
        )}
      </Link>
    </li>
  );
}

function RailSectionDrawn(props: {
  readonly section: RailSection;
  readonly onNavigate: (() => void) | undefined;
}): ReactNode {
  const section = props.section;
  const heading =
    "px-3 text-xs font-medium tracking-label text-ink-3 uppercase";
  return (
    <section className="grid gap-1">
      <h2 className={heading}>
        {section.to === undefined || section.params === undefined ? (
          section.heading
        ) : (
          <Link
            to={section.to}
            params={section.params}
            onClick={props.onNavigate}
            className="no-underline"
          >
            {section.heading}
          </Link>
        )}
      </h2>
      <ul className="grid">
        {section.entries.map((entry) => (
          <RailEntryDrawn
            key={entry.id}
            entry={entry}
            onNavigate={props.onNavigate}
          />
        ))}
      </ul>
    </section>
  );
}

function RailProjectSwitcher(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const navigate = useNavigate();
  const state = usePanelInventory((ports) => apiProjectInventoryAll(ports));
  if (state.state !== "Ready")
    return <Notice tone="parked" inline detail="Projects unavailable" />;
  return (
    <Picker
      label="Project"
      value={`${props.partition.tenant}/${props.partition.project}`}
      options={state.value.map((candidate) => ({
        value: `${candidate.tenant}/${candidate.project}`,
        text: `${candidate.tenant} / ${candidate.project}`,
      }))}
      onChoose={(picked) => {
        const chosen = state.value.find(
          (candidate) => `${candidate.tenant}/${candidate.project}` === picked,
        );
        if (chosen === undefined) return;
        lastProjectWrite(persistentStore, chosen);
        void navigate({
          to: "/$tenant/$project",
          params: { tenant: chosen.tenant, project: chosen.project },
        });
      }}
    />
  );
}

/** The choice is applied before it is stored, so a store a browser refuses
 * still leaves the operator looking at the theme they asked for. */
export function ThemeControl(): ReactNode {
  const [chosen, setChosen] = useState<ThemeChoice>(() =>
    themeChoiceRead(persistentStore),
  );
  return (
    <ToggleGroup
      label="Theme"
      options={themeChoices}
      value={chosen}
      onChange={(value) => {
        const choice = themeChoices.find((candidate) => candidate === value);
        if (choice === undefined) return;
        themeChoiceApply(document.documentElement, choice);
        themeChoiceWrite(persistentStore, choice);
        setChosen(choice);
      }}
    />
  );
}

function RailFoot(props: { readonly partition: PartitionIdentity }): ReactNode {
  const holder = useSessionHolder();
  return (
    <div className="grid justify-items-start gap-3 px-3">
      <RailProjectSwitcher partition={props.partition} />
      <ThemeControl />
      <Button
        variant="quiet"
        size="sm"
        onClick={() => {
          void holder.signOut();
        }}
      >
        Sign out
      </Button>
      <Footer />
    </div>
  );
}

function useRailSections(partition: PartitionIdentity): readonly RailSection[] {
  const threads = usePanelList(
    projectListReread<ThreadsResponse>(partition, "Session", threadsListName),
    (ports) => apiThreads(ports, partition),
  );
  const lead = useLead(partition);
  const inbox = useInboxRows(partition);
  return shellRailSections({
    partition,
    threads: threads.state === "Ready" ? threads.value.threads : undefined,
    leadStanding:
      lead.state === "Ready"
        ? { word: lead.value.state, tone: sessionStateTone(lead.value.state) }
        : undefined,
    inboxCount: inboxCountLabel(inbox.union),
  });
}

export function Rail(props: {
  readonly partition: PartitionIdentity;
  readonly onNavigate?: (() => void) | undefined;
}): ReactNode {
  const sections = useRailSections(props.partition);
  return (
    <nav
      aria-label="Console"
      className="flex h-full min-h-0 flex-col gap-4 bg-surface-1 py-4"
    >
      <Link
        to="/"
        onClick={props.onNavigate}
        className="px-4 text-md font-strong tracking-label text-ink-1 no-underline"
      >
        chuggy
      </Link>
      <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto px-2">
        {sections.map((section) => (
          <RailSectionDrawn
            key={section.id}
            section={section}
            onNavigate={props.onNavigate}
          />
        ))}
      </div>
      <Separator.Root decorative className="h-px bg-edge" />
      <RailFoot partition={props.partition} />
    </nav>
  );
}
