/**
 * Everything a reader reaches rarely, behind one gear in the bar: the pages
 * that set the open project up, how the console looks, the wording it is
 * drawn in for a site administrator, where the chat pane sits where the frame
 * divides and has one, and signing out.
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
import { copyLocale } from "../../copy/catalog.ts";
import { useCopyText, useCopyWording } from "../../copy/CopyProvider.tsx";
import { copyPseudoLocale } from "../../copy/copyPseudo.ts";
import type { Copy } from "../../core/copy.ts";
import { navEntryCurrent, shellSetupNav } from "../../core/shellNav.ts";
import {
  chatPaneOnPage,
  chatPanePlaceable,
  chatPanePlacements,
  chatPaneRepositioned,
} from "../../core/chatPane.ts";
import type { ChatPanePlacement } from "../../core/chatPane.ts";
import { persistentStore } from "../ports.ts";
import { useSessionHolder } from "../session.tsx";
import { useSiteAbilities } from "../settings/tenantPermissionsResource.ts";
import {
  themeChoiceApply,
  themeChoiceRead,
  themeChoiceWrite,
  themeChoices,
} from "../theme.ts";
import type { ThemeChoice } from "../theme.ts";
import { buttonLookClassName } from "../ui/Button.tsx";
import { MenuContent, menuItemClassName } from "../ui/Menu.tsx";
import { useChatPane, useChatPaneYields } from "./chatPaneHeld.ts";
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

const settingsThemeWords: Readonly<Record<ThemeChoice, Copy>> = {
  System: { id: "shell-settings-theme-system" },
  Light: { id: "shell-settings-theme-light" },
  Dark: { id: "shell-settings-theme-dark" },
};

const settingsChatWords: Readonly<Record<ChatPanePlacement, Copy>> = {
  Right: { id: "shell-settings-chat-right" },
  Left: { id: "shell-settings-chat-left" },
  Bottom: { id: "shell-settings-chat-bottom" },
};

/** One labelled roster of radio items, which is the shape every choice in this
 * menu takes. */
function SettingsChoice<Option extends string>(props: {
  readonly label: Copy;
  readonly value: Option;
  readonly options: readonly Option[];
  readonly words: Readonly<Record<Option, Copy>>;
  readonly onChoose: (value: string) => void;
}): ReactNode {
  const text = useCopyText();
  return (
    <>
      <DropdownMenu.Label className="text-ink-3 px-2 py-1 text-xs">
        {text(props.label)}
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
            {text(props.words[option])}
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
      label={{ id: "shell-settings-theme" }}
      value={chosen}
      options={themeChoices}
      words={settingsThemeWords}
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

/** A vernacular is named by what follows its private-use subtag. */
function settingsWordingWord(wording: string): Copy {
  if (wording === copyLocale) return { id: "shell-settings-wording-standard" };
  if (wording === copyPseudoLocale)
    return { id: "shell-settings-wording-pseudo" };
  const name = wording.slice(`${copyLocale}-x-`.length);
  return {
    id: "shell-settings-wording-vernacular",
    args: { name: name.charAt(0).toUpperCase() + name.slice(1) },
  };
}

/** The wording the console is drawn in, offered to a site administrator
 * alone: it compares wordings, and a read that failed draws the same as one
 * that said no. */
function SettingsWording(props: { readonly tenant: string }): ReactNode {
  const abilities = useSiteAbilities(props.tenant);
  const held = useCopyWording();
  if (abilities.state !== "Ready" || !abilities.value.administer) return null;
  return (
    <>
      <DropdownMenu.Separator className="bg-edge my-1 h-px" />
      <SettingsChoice
        label={{ id: "shell-settings-wording" }}
        value={held.wording}
        options={held.wordings}
        words={Object.fromEntries(
          held.wordings.map((wording) => [
            wording,
            settingsWordingWord(wording),
          ]),
        )}
        onChoose={(picked) => {
          const wording = held.wordings.find(
            (candidate) => candidate === picked,
          );
          if (wording !== undefined) held.choose(wording);
        }}
      />
    </>
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
        label={{ id: "shell-settings-chat" }}
        value={held.state.placement}
        options={chatPanePlacements}
        words={settingsChatWords}
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
  const text = useCopyText();
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
            {text(entry.label)}
          </Link>
        </DropdownMenu.Item>
      ))}
      <DropdownMenu.Separator className="bg-edge my-1 h-px" />
    </>
  );
}

function SettingsSignOut(): ReactNode {
  const holder = useSessionHolder();
  const text = useCopyText();
  return (
    <DropdownMenu.Item
      className={menuItemClassName}
      onSelect={() => {
        void holder.signOut();
      }}
    >
      <span className="picker-gutter" />
      {text({ id: "shell-sign-out" })}
    </DropdownMenu.Item>
  );
}

export function SettingsMenu(props: {
  readonly partition: PartitionIdentity | undefined;
  /** The tenant the page is in, where one is known. */
  readonly tenant: string | undefined;
}): ReactNode {
  const text = useCopyText();
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        className={buttonLookClassName({ size: "sm", variant: "quiet" })}
      >
        <SettingsGear />
        <span className="visually-hidden">
          {text({ id: "shell-settings" })}
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <MenuContent className="settings-menu" sideOffset={4} align="end">
          {props.partition === undefined ? null : (
            <SettingsSetup partition={props.partition} />
          )}
          <SettingsTheme />
          {props.tenant === undefined ? null : (
            <SettingsWording tenant={props.tenant} />
          )}
          {props.partition === undefined ? null : <SettingsChatPlacement />}
          <DropdownMenu.Separator className="bg-edge my-1 h-px" />
          <SettingsSignOut />
        </MenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
