/**
 * The reader's preferences, each kept in this browser: how the console looks,
 * the wording it is drawn in, and where the chat pane sits.
 *
 * The page is its sections and nothing else, each a panel of its own that
 * draws nothing for a reader it is not offered to, so a preference is added
 * as a section, or as a control inside the one it belongs to.
 *
 * The wording is offered to a site administrator alone: it compares wordings,
 * and a read that failed draws the same as one that said no. Where the pane
 * sits is offered only under a project, which is where a pane is drawn, and
 * only where the viewport divides, since below two columns the pane is the
 * whole body or the strip under the pages wherever it sits.
 */

import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import { copyLocale } from "../../copy/catalog.ts";
import { useCopyText, useCopyWording } from "../../copy/CopyProvider.tsx";
import { copyPseudoLocale } from "../../copy/copyPseudo.ts";
import {
  chatPaneOnPage,
  chatPanePlaceable,
  chatPanePlacements,
  chatPaneRepositioned,
} from "../../core/chatPane.ts";
import type { ChatPanePlacement } from "../../core/chatPane.ts";
import type { Copy } from "../../core/copy.ts";
import { persistentStore } from "../ports.ts";
import { useChatPane } from "../shell/chatPaneHeld.ts";
import {
  themeChoiceApply,
  themeChoiceRead,
  themeChoiceWrite,
  themeChoices,
} from "../theme.ts";
import type { ThemeChoice } from "../theme.ts";
import { Panel } from "../ui/Panel.tsx";
import { RadioGroup } from "../ui/RadioGroup.tsx";
import { SettingsPage, useSettingsTenant } from "./SettingsPage.tsx";
import { useSiteAbilities } from "./tenantPermissionsResource.ts";

import "./PreferencesPage.css";

const preferencesSchemeWords: Readonly<Record<ThemeChoice, Copy>> = {
  System: { id: "settings-preferences-scheme-system" },
  Light: { id: "settings-preferences-scheme-light" },
  Dark: { id: "settings-preferences-scheme-dark" },
};

const preferencesChatWords: Readonly<Record<ChatPanePlacement, Copy>> = {
  Right: { id: "settings-preferences-chat-right" },
  Left: { id: "settings-preferences-chat-left" },
  Bottom: { id: "settings-preferences-chat-bottom" },
};

/** One preference's panel: its title, and the control or controls it holds. */
export function PreferencesSection(props: {
  readonly title: Copy;
  readonly children: ReactNode;
}): ReactNode {
  const text = useCopyText();
  return (
    <Panel variant="section" title={text(props.title)}>
      {props.children}
    </Panel>
  );
}

/** One labelled roster of options, which is the shape every choice on this
 * page takes. */
function PreferencesChoice<Option extends string>(props: {
  readonly label: Copy;
  readonly value: Option;
  readonly options: readonly Option[];
  readonly words: Readonly<Record<Option, Copy>>;
  readonly onChoose: (value: Option) => void;
}): ReactNode {
  const text = useCopyText();
  return (
    <RadioGroup
      label={text(props.label)}
      value={props.value}
      options={props.options.map((option) => ({
        value: option,
        text: text(props.words[option]),
      }))}
      onChoose={(picked) => {
        const option = props.options.find((candidate) => candidate === picked);
        if (option !== undefined) props.onChoose(option);
      }}
    />
  );
}

/** The scheme the reader chose, applied before it is stored so a store a
 * browser refuses still leaves them looking at what they asked for. */
function PreferencesScheme(): ReactNode {
  const [chosen, setChosen] = useState<ThemeChoice>(() =>
    themeChoiceRead(persistentStore),
  );
  return (
    <PreferencesChoice
      label={{ id: "settings-preferences-scheme" }}
      value={chosen}
      options={themeChoices}
      words={preferencesSchemeWords}
      onChoose={(choice) => {
        themeChoiceApply(document.documentElement, choice);
        themeChoiceWrite(persistentStore, choice);
        setChosen(choice);
      }}
    />
  );
}

function PreferencesAppearance(): ReactNode {
  return (
    <PreferencesSection title={{ id: "settings-preferences-appearance" }}>
      <PreferencesScheme />
    </PreferencesSection>
  );
}

/** A vernacular is named by what follows its private-use subtag. */
function preferencesWordingWord(wording: string): Copy {
  if (wording === copyLocale)
    return { id: "settings-preferences-wording-standard" };
  if (wording === copyPseudoLocale)
    return { id: "settings-preferences-wording-pseudo" };
  const name = wording.slice(`${copyLocale}-x-`.length);
  return {
    id: "settings-preferences-wording-vernacular",
    args: { name: name.charAt(0).toUpperCase() + name.slice(1) },
  };
}

function PreferencesWording(props: { readonly tenant: string }): ReactNode {
  const abilities = useSiteAbilities(props.tenant);
  const held = useCopyWording();
  if (abilities.state !== "Ready" || !abilities.value.administer) return null;
  return (
    <PreferencesSection title={{ id: "settings-preferences-wording" }}>
      <PreferencesChoice
        label={{ id: "settings-preferences-wording" }}
        value={held.wording}
        options={held.wordings}
        words={Object.fromEntries(
          held.wordings.map((wording) => [
            wording,
            preferencesWordingWord(wording),
          ]),
        )}
        onChoose={held.choose}
      />
    </PreferencesSection>
  );
}

export function PreferencesChatPosition(): ReactNode {
  const held = useChatPane();
  const route = useParams({ strict: false });
  if (route.project === undefined) return null;
  if (!chatPanePlaceable(held.twoColumn)) return null;
  if (chatPaneOnPage(held.state, route) === undefined) return null;
  return (
    <PreferencesSection title={{ id: "settings-preferences-chat" }}>
      <PreferencesChoice
        label={{ id: "settings-preferences-chat" }}
        value={held.state.placement}
        options={chatPanePlacements}
        words={preferencesChatWords}
        onChoose={(placement) => {
          held.moveTo(chatPaneRepositioned(held.state, placement));
        }}
      />
    </PreferencesSection>
  );
}

export function PreferencesPage(): ReactNode {
  const text = useCopyText();
  const tenant = useSettingsTenant();
  return (
    <SettingsPage title={text({ id: "settings-nav-preferences" })}>
      <div className="preferences grid min-w-0 max-w-settings gap-4">
        <PreferencesAppearance />
        <PreferencesWording tenant={tenant} />
        <PreferencesChatPosition />
      </div>
    </SettingsPage>
  );
}
