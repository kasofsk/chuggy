/**
 * The bar above every page: which project is open and the controls that belong
 * to the frame on one row, the screens the project holds on the next, and the
 * page's own title and chips beneath them.
 *
 * The page's row is drawn only where a page filled a slot, so a screen that
 * says nothing about itself gives the height back to the page rather than
 * spending it on a heading the project switcher already carries.
 *
 * The project's row is drawn on its own and the rows under it apart, so the
 * frame can give the chat pane their room: where the viewport does not divide,
 * a pane over the whole body takes them too, and the project's row stays.
 *
 * The project's primary places are the bar's, drawn from `shellNav.ts`; the
 * settings, the reader's preferences and signing out sit behind the account
 * menu beside the project. A screen outside every project draws the same bar
 * without what only a project has — its screens and its page row — so
 * signing out is reachable before there is a project to open.
 */

import { Link, useRouterState } from "@tanstack/react-router";
import { Separator } from "radix-ui";
import { Fragment } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { inboxCountLabel } from "../../core/inboxList.ts";
import { projectAbilityRefused } from "../../core/projectAbilities.ts";
import type { ShellCrumb } from "../../core/shellCrumbs.ts";
import { memberChatCrumbs, shellCrumbs } from "../../core/shellCrumbs.ts";
import { navEntryCurrent, shellNav } from "../../core/shellNav.ts";
import type { NavEntry } from "../../core/shellNav.ts";
import { useInboxRows } from "../Inbox.tsx";
import { useProjectAbilities } from "../projectAbilities.tsx";
import { Pill } from "../ui/Pill.tsx";
import { useChatPaneYields } from "./chatPaneHeld.ts";
import { DetailsToggle } from "./DetailsPane.tsx";
import { NavIcon } from "./navIcons.tsx";
import { ProjectSwitcher } from "./ProjectSwitcher.tsx";
import { AccountMenu } from "./AccountMenu.tsx";
import { useShellSlotHolder, useShellSlotsFilled } from "./slots.tsx";

/** One screen's entry, which also moves a pane that filled the body out of
 * the way, as `useChatPaneYields` says. */
export function TopBarNavEntry(props: { readonly entry: NavEntry }): ReactNode {
  const entry = props.entry;
  const text = useCopyText();
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
        <span className="topbar-entry-label">{text(entry.label)}</span>
      </Link>
    </li>
  );
}

/** The project's primary places but the inbox, which sits beside the account
 * menu. */
function TopBarNav(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const abilities = useProjectAbilities(props.partition);
  const text = useCopyText();
  const entries = shellNav(props.partition).filter(
    (entry) => entry.id !== "inbox",
  );
  return (
    <nav aria-label={text({ id: "shell-nav" })} className="min-w-0">
      <ul className="topbar-nav">
        {entries.map((entry) => (
          <TopBarNavEntry key={entry.id} entry={entry} />
        ))}
        {projectAbilityRefused(abilities, "mutate") ? (
          <li className="px-3">
            <Pill tone="neutral">{text({ id: "shell-view-only" })}</Pill>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}

/** The inbox beside the account menu, with a badge for what waits in it. */
function TopBarInbox(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const yields = useChatPaneYields();
  const text = useCopyText();
  const count = inboxCountLabel(useInboxRows(props.partition).rows);
  const entry = shellNav(props.partition).find((place) => place.id === "inbox");
  const current = useRouterState({
    select: (router) =>
      entry !== undefined && navEntryCurrent(entry, router.location.pathname),
  });
  if (entry === undefined) return null;
  return (
    <Link
      to={entry.to}
      params={entry.params}
      onClick={yields}
      aria-current={current ? "page" : undefined}
      aria-label={text(
        count === undefined
          ? entry.label
          : { id: "shell-inbox-unread", args: { count } },
      )}
      className="topbar-inbox"
    >
      <NavIcon id="inbox" />
      {count === undefined ? null : (
        <span aria-hidden="true" className="topbar-inbox-badge">
          {count}
        </span>
      )}
    </Link>
  );
}

/** The toggle for a page's details, where a page filled them. */
function TopBarDetails(): ReactNode {
  return useShellSlotsFilled().details ? <DetailsToggle /> : null;
}

function TopBarPage(): ReactNode {
  const filled = useShellSlotsFilled();
  const holdTopBar = useShellSlotHolder("topBar");
  if (!filled.topBar) return null;
  return (
    <>
      <Separator.Root decorative className="h-px bg-edge" />
      <div className="flex min-w-0 items-center gap-3 px-4 py-2">
        <div
          ref={holdTopBar}
          className="flex min-w-0 flex-1 items-center gap-3"
        />
      </div>
    </>
  );
}

/** The trail's crumbs, each level that has a page linking to it and the last
 * one named, each marked as the address it is rather than words to translate. */
function TopBarTrail(props: {
  readonly crumbs: readonly ShellCrumb[];
}): ReactNode {
  const { crumbs } = props;
  const text = useCopyText();
  return (
    <nav aria-label={text({ id: "shell-crumbs" })} className="topbar-crumbs">
      {crumbs.map((crumb, at) => {
        const last = at === crumbs.length - 1;
        return (
          <Fragment key={at}>
            {at === 0 ? null : <span aria-hidden="true">/</span>}
            {crumb.link === undefined || last ? (
              <span
                className="topbar-crumb"
                translate="no"
                {...(last ? { "aria-current": "page" as const } : {})}
              >
                {crumb.label}
              </span>
            ) : (
              <Link
                to={crumb.link.to}
                params={crumb.link.params}
                className="topbar-crumb"
                translate="no"
              >
                {crumb.label}
              </Link>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}

/** Where the reader is in a project, workspace to item. */
function TopBarCrumbs(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  return <TopBarTrail crumbs={shellCrumbs(props.partition, pathname)} />;
}

/** The rows of a project's bar under its first: its screens, then the page's
 * own row where a page filled it. */
export function TopBarRows(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  return (
    <>
      <div className="topbar-rows">
        <TopBarNav partition={props.partition} />
      </div>
      <TopBarPage />
    </>
  );
}

/** The bar's first row: where the reader is, and the frame's controls. */
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
          {partition !== undefined ? (
            <TopBarCrumbs partition={partition} />
          ) : (
            <TopBarTrail
              crumbs={
                props.chat === undefined ? [] : memberChatCrumbs(props.chat)
              }
            />
          )}
          <div className="topbar-actions flex shrink-0 items-center justify-end">
            {partition === undefined ? null : <TopBarDetails />}
            <div className="topbar-project">
              <ProjectSwitcher
                partition={partition}
                {...(props.chat === undefined ? {} : { chat: props.chat })}
              />
            </div>
            {partition === undefined ? null : (
              <TopBarInbox partition={partition} />
            )}
            <AccountMenu
              project={partition?.project}
              tenant={partition?.tenant ?? props.chat}
            />
          </div>
        </div>
      </header>
    </div>
  );
}
