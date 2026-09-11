/**
 * The frame's own settings, behind one gear in the bar: how the console looks,
 * and where the chat pane sits.
 *
 * These are the controls that belong to the frame rather than to any page, and
 * a reader sets them once and forgets them — so the bar carries the gear and
 * the choices live inside it, rather than every choice spending bar width on
 * every screen.
 *
 * `modal={false}` keeps `react-remove-scroll` out of the tree: it appends a
 * `<style>` element the served `style-src 'self'` refuses.
 */

import { DropdownMenu } from "radix-ui";
import type { ReactNode } from "react";

import {
  chatPanePlacements,
  chatPaneRepositioned,
} from "../../core/chatPane.ts";
import { persistentStore } from "../ports.ts";
import {
  themeChoiceApply,
  themeChoiceRead,
  themeChoiceWrite,
  themeChoices,
} from "../theme.ts";
import type { ThemeChoice } from "../theme.ts";
import { buttonLookClassName } from "../ui/Button.tsx";
import { MenuContent, menuItemClassName } from "../ui/Menu.tsx";
import { useChatPane } from "./chatPaneHeld.tsx";
import { useState } from "react";

import "../ui/Picker.css";

function SettingsGear(): ReactNode {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="2.25" />
      <path d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5 3.4 3.4" />
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

function SettingsChatPlacement(): ReactNode {
  const held = useChatPane();
  return (
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
  );
}

export function SettingsMenu(): ReactNode {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        className={buttonLookClassName({ size: "sm", variant: "quiet" })}
      >
        <SettingsGear />
        <span className="visually-hidden">Settings</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <MenuContent sideOffset={4} align="end">
          <SettingsTheme />
          <DropdownMenu.Separator className="bg-edge my-1 h-px" />
          <SettingsChatPlacement />
        </MenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
