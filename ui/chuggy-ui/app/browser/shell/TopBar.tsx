/**
 * The bar above every page: which project is open and the controls that belong
 * to the frame on one row, the screens the project holds on the next, and the
 * page's own title and chips beneath them.
 *
 * The page's row is drawn only where a page filled a slot, so a screen that
 * says nothing about itself gives the height back to the page rather than
 * spending it on a heading the project switcher already carries.
 *
 * The frame's own controls and the project's setup pages sit behind the gear
 * beside the project. A screen outside every project draws the same bar without what
 * only a project has — its screens, its setup and its page row — so signing
 * out and the theme are reachable before there is a project to open.
 */

import { Link, useRouterState } from "@tanstack/react-router";
import { Separator } from "radix-ui";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { inboxCountLabel } from "../../core/inboxList.ts";
import { projectAbilityRefused } from "../../core/projectAbilities.ts";
import { projectLeadFound } from "../../core/projectLead.ts";
import { navEntryCurrent, shellNav } from "../../core/shellNav.ts";
import type { NavEntry } from "../../core/shellNav.ts";
import { sessionStateTone } from "../../core/tones.ts";
import type { Tone } from "../../core/tones.ts";
import { useInboxRows } from "../Inbox.tsx";
import { useLead } from "../LeadPage.tsx";
import { useProjectAbilities } from "../projectAbilities.tsx";
import { Pill } from "../ui/Pill.tsx";
import { useChatPaneYields } from "./chatPaneHeld.tsx";
import { DetailsToggle } from "./DetailsPane.tsx";
import { NavIcon } from "./navIcons.tsx";
import { ProjectSwitcher } from "./ProjectSwitcher.tsx";
import { SettingsMenu } from "./SettingsMenu.tsx";
import { useShellSlotHolder, useShellSlotsFilled } from "./slots.tsx";

/** The fill a standing's dot takes, total over the roster so a tone the wire
 * grows stops compiling rather than drawing nothing. */
const navDotFills: Readonly<Record<Tone, string>> = {
  pass: "bg-tone-pass",
  fail: "bg-tone-fail",
  live: "bg-tone-live",
  evaluation: "bg-tone-evaluation",
  finalization: "bg-tone-finalization",
  queued: "bg-tone-queued",
  parked: "bg-tone-parked",
  retired: "bg-tone-retired",
  neutral: "bg-ink-3",
};

/** One screen's entry, which also moves a pane that filled the body out of
 * the way, as `useChatPaneYields` says. */
export function TopBarNavEntry(props: { readonly entry: NavEntry }): ReactNode {
  const entry = props.entry;
  const yields = useChatPaneYields();
  const current = useRouterState({
    select: (router) => navEntryCurrent(entry, router.location.pathname),
  });
  return (
    <li>
      <Link
        to={entry.to}
        params={entry.params}
        onClick={yields}
        activeOptions={{ exact: true }}
        aria-current={current ? "page" : undefined}
        className="topbar-entry"
      >
        <NavIcon id={entry.id} />
        {entry.standing === undefined ? null : (
          <>
            <i
              aria-hidden="true"
              className={`block size-2 shrink-0 rounded-circle ${navDotFills[entry.standing.tone]}`}
            />
            <span className="visually-hidden">{entry.standing.word}</span>
          </>
        )}
        <span className="topbar-entry-label">{entry.label}</span>
        {entry.count === undefined ? null : (
          <span className="text-xs text-ink-3 tabular-nums">{entry.count}</span>
        )}
      </Link>
    </li>
  );
}

function TopBarNav(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const read = useLead(props.partition);
  const lead =
    read.state === "Ready" ? projectLeadFound(read.value) : undefined;
  const inbox = useInboxRows(props.partition);
  const abilities = useProjectAbilities(props.partition);
  const entries = shellNav({
    partition: props.partition,
    leadStanding:
      lead === undefined
        ? undefined
        : { word: lead.state, tone: sessionStateTone(lead.state) },
    inboxCount: inboxCountLabel(inbox.union),
    abilities,
  });
  return (
    <nav aria-label="Console" className="min-w-0">
      <ul className="topbar-nav">
        {entries.map((entry) => (
          <TopBarNavEntry key={entry.id} entry={entry} />
        ))}
        {projectAbilityRefused(abilities, "mutate") ? (
          <li className="px-3">
            <Pill tone="neutral">View only</Pill>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}

function TopBarPage(): ReactNode {
  const filled = useShellSlotsFilled();
  const holdTopBar = useShellSlotHolder("topBar");
  if (!filled.topBar && !filled.details) return null;
  return (
    <>
      <Separator.Root decorative className="h-px bg-edge" />
      <div className="flex min-w-0 items-center gap-3 px-4 py-2">
        <div
          ref={holdTopBar}
          className="flex min-w-0 flex-1 items-center gap-3"
        />
        {filled.details ? <DetailsToggle /> : null}
      </div>
    </>
  );
}

export function TopBar(props: {
  readonly partition: PartitionIdentity | undefined;
  /** The tenant whose chat outside every project the page is, where it is. */
  readonly chat?: string;
}): ReactNode {
  const partition = props.partition;
  return (
    <div className="grid">
      <header className="topbar">
        <div className="topbar-main">
          <div className="topbar-project">
            <ProjectSwitcher
              partition={partition}
              {...(props.chat === undefined ? {} : { chat: props.chat })}
            />
          </div>
          <div className="flex shrink-0 items-center justify-end">
            <SettingsMenu partition={partition} />
          </div>
        </div>
        {partition === undefined ? null : <TopBarNav partition={partition} />}
      </header>
      {partition === undefined ? null : <TopBarPage />}
    </div>
  );
}
