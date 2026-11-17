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
 * menu beside the project. On a phone the places, the inbox among them, leave
 * the top for a bar along the foot of the frame, each named under its glyph.
 * A screen outside every project draws the same bar without what only a
 * project has — its screens and its page row — so signing out is reachable
 * before there is a project to open.
 */

import { Link, useRouterState } from "@tanstack/react-router";
import { DropdownMenu, Separator } from "radix-ui";
import { Fragment } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { inboxCountLabel } from "../../core/inboxList.ts";
import { projectAbilityRefused } from "../../core/projectAbilities.ts";
import type { ShellCrumb } from "../../core/shellCrumbs.ts";
import { memberChatCrumbs, shellCrumbs } from "../../core/shellCrumbs.ts";
import {
  navEntryCurrent,
  shellNav,
  shellNavPhone,
} from "../../core/shellNav.ts";
import type { NavEntry } from "../../core/shellNav.ts";
import { useInboxRows } from "../Inbox.tsx";
import { useProjectAbilities } from "../projectAbilities.tsx";
import { CountBadge } from "../ui/CountBadge.tsx";
import { MenuContent, menuItemClassName } from "../ui/Menu.tsx";
import { Pill } from "../ui/Pill.tsx";
import { useChatPaneYields } from "./chatPaneHeld.ts";
import { DetailsToggle } from "./DetailsPane.tsx";
import { NavIcon } from "./navIcons.tsx";
import { ProjectSwitcher } from "./ProjectSwitcher.tsx";
import { AccountMenu } from "./AccountMenu.tsx";
import { useShellSlotHolder, useShellSlotsFilled } from "./slots.tsx";
import { useViewportAtMostEm, viewportNarrowEm } from "./viewport.ts";

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
 * menu, in a row of their own; on a phone the places are the bar along its
 * foot, and the row is drawn only where it says the project is view only. */
function TopBarNav(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const abilities = useProjectAbilities(props.partition);
  const text = useCopyText();
  const phone = useViewportAtMostEm(viewportNarrowEm);
  const viewOnly = projectAbilityRefused(abilities, "mutate") ? (
    <Pill tone="neutral">{text({ id: "shell-view-only" })}</Pill>
  ) : null;
  if (phone)
    return viewOnly === null ? null : (
      <div className="topbar-rows">{viewOnly}</div>
    );
  const entries = shellNav(props.partition).filter(
    (entry) => entry.id !== "inbox",
  );
  return (
    <div className="topbar-rows">
      <nav aria-label={text({ id: "shell-nav" })} className="min-w-0">
        <ul className="topbar-nav">
          {entries.map((entry) => (
            <TopBarNavEntry key={entry.id} entry={entry} />
          ))}
          {viewOnly === null ? null : <li className="px-3">{viewOnly}</li>}
        </ul>
      </nav>
    </div>
  );
}

/** How many wait in the inbox, and nothing where it is clear; and the inbox's
 * name with it, for a reader who does not see the badge. */
function useTopBarInboxCount(
  partition: PartitionIdentity,
  entry: NavEntry,
): { readonly count: number | undefined; readonly label: string } {
  const text = useCopyText();
  const rows = useInboxRows(partition).rows;
  const figure = inboxCountLabel(rows);
  return {
    count: figure === undefined ? undefined : rows?.count,
    label: text(
      figure === undefined
        ? entry.label
        : { id: "shell-inbox-unread", args: { count: figure } },
    ),
  };
}

/** The inbox beside the account menu, with a badge for what waits in it; on
 * a phone the inbox is an item of the bar along its foot instead. */
function TopBarInbox(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const phone = useViewportAtMostEm(viewportNarrowEm);
  const entry = shellNav(props.partition).find((place) => place.id === "inbox");
  if (phone || entry === undefined) return null;
  return <TopBarInboxLink partition={props.partition} entry={entry} />;
}

function TopBarInboxLink(props: {
  readonly partition: PartitionIdentity;
  readonly entry: NavEntry;
}): ReactNode {
  const { entry } = props;
  const yields = useChatPaneYields();
  const { count, label } = useTopBarInboxCount(props.partition, entry);
  const current = useRouterState({
    select: (router) => navEntryCurrent(entry, router.location.pathname),
  });
  return (
    <Link
      to={entry.to}
      params={entry.params}
      onClick={yields}
      aria-current={current ? "page" : undefined}
      aria-label={label}
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

/** One item of a phone's bar: its glyph with its name under it, and where
 * it carries a count, a `CountBadge` on its glyph and the count in its name. */
function TopBarPhoneItem(props: {
  readonly entry: NavEntry;
  readonly count?: number | undefined;
  readonly label?: string | undefined;
}): ReactNode {
  const { entry, count } = props;
  const text = useCopyText();
  const yields = useChatPaneYields();
  const current = useRouterState({
    select: (router) => navEntryCurrent(entry, router.location.pathname),
  });
  return (
    <li className="topbar-phone-place">
      <Link
        to={entry.to}
        params={entry.params}
        onClick={yields}
        activeOptions={{ exact: true }}
        aria-current={current ? "page" : undefined}
        aria-label={count === undefined ? undefined : props.label}
        className="topbar-phone-item"
      >
        <span className="topbar-phone-glyph">
          <NavIcon id={entry.id} />
          {count === undefined ? null : (
            <CountBadge count={count} name={props.label ?? ""} />
          )}
        </span>
        <span className="topbar-phone-label">{text(entry.label)}</span>
      </Link>
    </li>
  );
}

/** The inbox's item on a phone's bar, carrying what waits in it. */
function TopBarPhoneInbox(props: {
  readonly partition: PartitionIdentity;
  readonly entry: NavEntry;
}): ReactNode {
  const { count, label } = useTopBarInboxCount(props.partition, props.entry);
  return <TopBarPhoneItem entry={props.entry} count={count} label={label} />;
}

/** More, the last item of a phone's bar where its places outnumber its
 * items, opening the rest; it is marked where the reader is on one of them. */
function TopBarPhoneMore(props: {
  readonly entries: readonly NavEntry[];
}): ReactNode {
  const text = useCopyText();
  const yields = useChatPaneYields();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const held = props.entries.some((entry) => navEntryCurrent(entry, pathname));
  return (
    <li className="topbar-phone-place">
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger
          className="topbar-phone-item"
          data-current={held ? "" : undefined}
        >
          <NavIcon id="more" />
          <span className="topbar-phone-label">
            {text({ id: "shell-nav-more" })}
          </span>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <MenuContent className="topbar-phone-menu" side="top" align="end">
            {props.entries.map((entry) => (
              <DropdownMenu.Item
                key={entry.id}
                className={`${menuItemClassName} text-ink-1 no-underline`}
                asChild
              >
                <Link
                  to={entry.to}
                  params={entry.params}
                  onClick={yields}
                  activeOptions={{ exact: true }}
                  aria-current={
                    navEntryCurrent(entry, pathname) ? "page" : undefined
                  }
                >
                  {text(entry.label)}
                </Link>
              </DropdownMenu.Item>
            ))}
          </MenuContent>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </li>
  );
}

/**
 * A project's primary places on a phone, as a bar along the foot of the
 * screen where a thumb reaches, each its glyph with its name under it. It is
 * drawn only on a phone; wider, the places are the bar's row above the page.
 */
export function TopBarPhone(props: {
  readonly partition: PartitionIdentity;
  /** The most items the bar holds, which only a case states. */
  readonly itemsMax?: number;
}): ReactNode {
  const text = useCopyText();
  const phone = useViewportAtMostEm(viewportNarrowEm);
  if (!phone) return null;
  const laid = shellNavPhone(shellNav(props.partition), props.itemsMax);
  return (
    <nav aria-label={text({ id: "shell-nav" })} className="topbar-phone">
      <ul className="topbar-phone-items">
        {laid.items.map((entry) =>
          entry.id === "inbox" ? (
            <TopBarPhoneInbox
              key={entry.id}
              partition={props.partition}
              entry={entry}
            />
          ) : (
            <TopBarPhoneItem key={entry.id} entry={entry} />
          ),
        )}
        {laid.more.length === 0 ? null : (
          <TopBarPhoneMore entries={laid.more} />
        )}
      </ul>
    </nav>
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
      <TopBarNav partition={props.partition} />
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
