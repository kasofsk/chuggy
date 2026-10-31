/**
 * Everything a reader reaches rarely, behind one gear in the bar: the pages
 * that set the open project up, how the console looks, where the chat pane
 * sits where the frame divides and has one, and signing out.
 *
 * A reader visits these once and forgets them — so the bar carries the gear
 * and they live inside it, rather than each spending bar width on every
 * screen.
 *
 * `modal={false}` keeps `react-remove-scroll` out of the tree: it appends a
 * `<style>` element the served `style-src 'self'` refuses.
 */

import { Link, useParams, useRouterState } from "@tanstack/react-router";
import { DropdownMenu } from "radix-ui";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { navEntryCurrent, shellSetupNav } from "../../core/shellNav.ts";
import {
  chatPaneOnPage,
  chatPanePlaceable,
  chatPanePlacements,
  chatPaneRepositioned,
} from "../../core/chatPane.ts";
import { persistentStore } from "../ports.ts";
import { useSessionHolder } from "../session.tsx";
import {
  themeChoiceApply,
  themeChoiceRead,
  themeChoiceWrite,
  themeChoices,
} from "../theme.ts";
import type { ThemeChoice } from "../theme.ts";
import { buttonLookClassName } from "../ui/Button.tsx";
import { MenuContent, menuItemClassName } from "../ui/Menu.tsx";
import { useChatPane, useChatPaneYields } from "./chatPaneHeld.tsx";
import { NavIcon } from "./navIcons.tsx";
import { useState } from "react";

import "../ui/Picker.css";

function SettingsGear(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** One labelled roster of radio items, which is the shape every choice in this
 * menu takes. */
function SettingsChoice(props: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly string[];
  readonly onChoose: (value: string) => void;
}): ReactNode {
  return (
    <>
      <DropdownMenu.Label className="text-ink-3 px-2 py-1 text-xs">
        {props.label}
      </DropdownMenu.Label>
      <DropdownMenu.RadioGroup
        value={props.value}
        onValueChange={props.onChoose}
      >
        {props.options.map((option) => (
          <DropdownMenu.RadioItem
            key={option}
            className={menuItemClassName}
            value={option}
          >
            <span className="picker-gutter">
              <DropdownMenu.ItemIndicator className="picker-mark" />
            </span>
            {option}
          </DropdownMenu.RadioItem>
        ))}
      </DropdownMenu.RadioGroup>
    </>
  );
}

/** The theme the operator chose, applied before it is stored so a store a
 * browser refuses still leaves them looking at what they asked for. */
function SettingsTheme(): ReactNode {
  const [chosen, setChosen] = useState<ThemeChoice>(() =>
    themeChoiceRead(persistentStore),
  );
  return (
    <SettingsChoice
      label="Theme"
      value={chosen}
      options={themeChoices}
      onChoose={(value) => {
        const choice = themeChoices.find((candidate) => candidate === value);
        if (choice === undefined) return;
        themeChoiceApply(document.documentElement, choice);
        themeChoiceWrite(persistentStore, choice);
        setChosen(choice);
      }}
    />
  );
}

/** Where the pane sits, offered on every page that draws one where the
 * viewport divides. */
function SettingsChatPlacement(): ReactNode {
  const held = useChatPane();
  const route = useParams({ strict: false });
  if (!chatPanePlaceable(held.twoColumn)) return null;
  if (chatPaneOnPage(held.state, route) === undefined) return null;
  return (
    <>
      <DropdownMenu.Separator className="bg-edge my-1 h-px" />
      <SettingsChoice
        label="Chat position"
        value={held.state.placement}
        options={chatPanePlacements}
        onChoose={(picked) => {
          const placement = chatPanePlacements.find(
            (candidate) => candidate === picked,
          );
          if (placement === undefined) return;
          held.moveTo(chatPaneRepositioned(held.state, placement));
        }}
      />
    </>
  );
}

/** The project's setup pages, each a link that also moves a pane that filled
 * the body out of the way, as a screen's entry in the bar does. */
function SettingsSetup(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const yields = useChatPaneYields();
  const pathname = useRouterState({
    select: (router) => router.location.pathname,
  });
  return (
    <>
      {shellSetupNav(props.partition).map((entry) => (
        <DropdownMenu.Item
          key={entry.id}
          className={`${menuItemClassName} text-ink-1 no-underline`}
          asChild
        >
          <Link
            to={entry.to}
            params={entry.params}
            onClick={yields}
            aria-current={navEntryCurrent(entry, pathname) ? "page" : undefined}
          >
            <span className="picker-gutter">
              <NavIcon id={entry.id} />
            </span>
            {entry.label}
          </Link>
        </DropdownMenu.Item>
      ))}
      <DropdownMenu.Separator className="bg-edge my-1 h-px" />
    </>
  );
}

function SettingsSignOut(): ReactNode {
  const holder = useSessionHolder();
  return (
    <DropdownMenu.Item
      className={menuItemClassName}
      onSelect={() => {
        void holder.signOut();
      }}
    >
      <span className="picker-gutter" />
      Sign out
    </DropdownMenu.Item>
  );
}

export function SettingsMenu(props: {
  readonly partition: PartitionIdentity | undefined;
}): ReactNode {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        className={buttonLookClassName({ size: "sm", variant: "quiet" })}
      >
        <SettingsGear />
        <span className="visually-hidden">Settings</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <MenuContent className="settings-menu" sideOffset={4} align="end">
          {props.partition === undefined ? null : (
            <SettingsSetup partition={props.partition} />
          )}
          <SettingsTheme />
          {props.partition === undefined ? null : <SettingsChatPlacement />}
          <DropdownMenu.Separator className="bg-edge my-1 h-px" />
          <SettingsSignOut />
        </MenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
