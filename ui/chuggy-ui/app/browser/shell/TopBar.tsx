/**
 * The bar above every page: which project is open, the screens it holds, the
 * controls that belong to the frame, and the page's own title and chips
 * beneath them.
 *
 * The second row is drawn only where a page filled a slot, so a screen that
 * says nothing about itself gives the height back to the page rather than
 * spending it on a heading the project switcher already carries.
 */

import { Link } from "@tanstack/react-router";
import { Separator } from "radix-ui";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { inboxCountLabel } from "../../core/inboxList.ts";
import { shellNav } from "../../core/shellNav.ts";
import type { NavEntry } from "../../core/shellNav.ts";
import { sessionStateTone } from "../../core/tones.ts";
import type { Tone } from "../../core/tones.ts";
import { chatPaneRestored } from "../../core/chatPane.ts";
import { Footer } from "../Footer.tsx";
import { useInboxRows } from "../Inbox.tsx";
import { useLead } from "../LeadPage.tsx";
import { useSessionHolder } from "../session.tsx";
import { Button } from "../ui/Button.tsx";
import { ChatPaneToggle } from "./ChatPane.tsx";
import { useChatPane } from "./chatPaneHeld.tsx";
import { DetailsToggle } from "./DetailsPane.tsx";
import { ProjectSwitcher } from "./ProjectSwitcher.tsx";
import { SettingsMenu } from "./SettingsMenu.tsx";
import { useShellSlotHolder, useShellSlotsFilled } from "./slots.tsx";

/** The fill a standing's dot takes, total over the roster so a tone the wire
 * grows stops compiling rather than drawing nothing. */
const navDotFills: Readonly<Record<Tone, string>> = {
  pass: "bg-tone-pass",
  fail: "bg-tone-fail",
  live: "bg-tone-live",
  queued: "bg-tone-queued",
  parked: "bg-tone-parked",
  retired: "bg-tone-retired",
  neutral: "bg-ink-3",
};

/**
 * One screen's entry, which also puts the chat pane back beside the pages where
 * it had filled the body: a reader pressing for a screen is asking to see it,
 * and a pane still over the whole body would answer by drawing the chat again.
 * A pane the reader put away stays away — that press was theirs too.
 */
function TopBarNavEntry(props: { readonly entry: NavEntry }): ReactNode {
  const entry = props.entry;
  const held = useChatPane();
  return (
    <li>
      <Link
        to={entry.to}
        params={entry.params}
        onClick={() => {
          if (held.state.presentation === "Full")
            held.moveTo(chatPaneRestored(held.state));
        }}
        className="flex items-center gap-2 rounded-2 px-3 py-1 text-md whitespace-nowrap no-underline"
        activeProps={{ className: "bg-surface-2 text-ink-1" }}
        inactiveProps={{ className: "text-ink-2" }}
      >
        {entry.standing === undefined ? null : (
          <>
            <i
              aria-hidden="true"
              className={`block size-2 shrink-0 rounded-circle ${navDotFills[entry.standing.tone]}`}
            />
            <span className="visually-hidden">{entry.standing.word}</span>
          </>
        )}
        <span className="truncate">{entry.label}</span>
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
  const lead = useLead(props.partition);
  const inbox = useInboxRows(props.partition);
  const entries = shellNav({
    partition: props.partition,
    leadStanding:
      lead.state === "Ready"
        ? { word: lead.value.state, tone: sessionStateTone(lead.value.state) }
        : undefined,
    inboxCount: inboxCountLabel(inbox.union),
  });
  return (
    <nav aria-label="Console" className="min-w-0">
      <ul className="flex min-w-0 flex-wrap items-center gap-1">
        {entries.map((entry) => (
          <TopBarNavEntry key={entry.id} entry={entry} />
        ))}
      </ul>
    </nav>
  );
}

function TopBarSignOut(): ReactNode {
  const holder = useSessionHolder();
  return (
    <Button
      variant="quiet"
      size="sm"
      onClick={() => {
        void holder.signOut();
      }}
    >
      Sign out
    </Button>
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
  readonly partition: PartitionIdentity;
}): ReactNode {
  return (
    <div className="grid">
      <header className="flex min-w-0 flex-wrap items-center gap-3 px-4 py-2">
        <Link
          to="/"
          className="text-md font-strong tracking-label text-ink-1 no-underline"
        >
          chuggy
        </Link>
        <ProjectSwitcher partition={props.partition} />
        <TopBarNav partition={props.partition} />
        <div className="flex flex-1 items-center justify-end gap-3">
          <ChatPaneToggle />
          <SettingsMenu />
          <TopBarSignOut />
          <Footer />
        </div>
      </header>
      <TopBarPage />
    </div>
  );
}
