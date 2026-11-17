/**
 * The reader's own preferences, a section each: how the console looks, the
 * wording it is drawn in, and where the chat pane sits. A section is a titled
 * region of its own, so what is added to one is added inside it and a new
 * one is one more entry in the page's list.
 *
 * Every choice is applied as it is made. The theme is kept by the server, as
 * `PreferencesTheme.tsx` says; every other choice is kept in this browser, as
 * each one's own module says.
 */

import { useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useState } from "react";

import { copyLocale } from "../../copy/catalog.ts";
import { useCopyText, useCopyWording } from "../../copy/CopyProvider.tsx";
import { copyPseudoLocale } from "../../copy/copyPseudo.ts";
import {
  chatPanePlaceable,
  chatPanePlacements,
  chatPaneRepositioned,
} from "../../core/chatPane.ts";
import type { ChatPanePlacement } from "../../core/chatPane.ts";
import type { Copy } from "../../core/copy.ts";
import { persistentStore } from "../ports.ts";
import {
  projectBannersChoices,
  projectBannersRead,
  projectBannersWrite,
} from "../projectBanners.ts";
import type { ProjectBannersChoice } from "../projectBanners.ts";
import { useChatPane } from "../shell/chatPaneHeld.ts";
import {
  schemeChoiceApply,
  schemeChoiceRead,
  schemeChoiceWrite,
  schemeChoices,
} from "../scheme.ts";
import type { SchemeChoice } from "../scheme.ts";
import { Panel } from "../ui/Panel.tsx";
import { RadioGroup } from "../ui/RadioGroup.tsx";
import { PreferencesTheme } from "./PreferencesTheme.tsx";
import { SettingsPage, useSettingsTenant } from "./SettingsPage.tsx";
import { useSiteAbilities } from "./tenantPermissionsResource.ts";

import "./PreferencesPage.css";

/** One section of the page, titled, holding whatever choices are its. */
export function PreferencesSection(props: {
  readonly title: Copy;
  readonly children: ReactNode;
}): ReactNode {
  const text = useCopyText();
  return (
    <Panel variant="section" title={text(props.title)}>
      <div className="preferences-section">{props.children}</div>
    </Panel>
  );
}

/** One labelled roster of radio options, which is the shape every choice on
 * the page takes. */
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
      onChoose={(value) => {
        const chosen = props.options.find((option) => option === value);
        if (chosen !== undefined) props.onChoose(chosen);
      }}
    />
  );
}

const preferencesSchemeWords: Readonly<Record<SchemeChoice, Copy>> = {
  System: { id: "settings-preferences-scheme-system" },
  Light: { id: "settings-preferences-scheme-light" },
  Dark: { id: "settings-preferences-scheme-dark" },
};

/** Light, dark or the system's, applied before it is stored so a store a
 * browser refuses still leaves the reader looking at what they asked for. */
function PreferencesScheme(): ReactNode {
  const [chosen, setChosen] = useState<SchemeChoice>(() =>
    schemeChoiceRead(persistentStore),
  );
  return (
    <PreferencesChoice
      label={{ id: "settings-preferences-scheme" }}
      value={chosen}
      options={schemeChoices}
      words={preferencesSchemeWords}
      onChoose={(choice) => {
        schemeChoiceApply(document.documentElement, choice);
        schemeChoiceWrite(persistentStore, choice);
        setChosen(choice);
      }}
    />
  );
}

const preferencesBannersWords: Readonly<Record<ProjectBannersChoice, Copy>> =
  {
    Shown: { id: "settings-preferences-banners-shown" },
    Hidden: { id: "settings-preferences-banners-hidden" },
  };

/** Whether projects' banners are drawn, as `projectBanners.ts` keeps it. */
function PreferencesBanners(): ReactNode {
  const [chosen, setChosen] = useState<ProjectBannersChoice>(() =>
    projectBannersRead(persistentStore),
  );
  return (
    <PreferencesChoice
      label={{ id: "settings-preferences-banners" }}
      value={chosen}
      options={projectBannersChoices}
      words={preferencesBannersWords}
      onChoose={(choice) => {
        projectBannersWrite(persistentStore, choice);
        setChosen(choice);
      }}
    />
  );
}

function PreferencesAppearance(): ReactNode {
  return (
    <PreferencesSection title={{ id: "settings-preferences-appearance" }}>
      <PreferencesScheme />
      <PreferencesTheme />
      <PreferencesBanners />
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

/** The wording the console is drawn in, offered to a site administrator
 * alone: it compares wordings, and a read that failed draws the same as one
 * that said no. */
function PreferencesWording(): ReactNode {
  const abilities = useSiteAbilities(useSettingsTenant());
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

const preferencesChatWords: Readonly<Record<ChatPanePlacement, Copy>> = {
  Right: { id: "settings-preferences-chat-right" },
  Left: { id: "settings-preferences-chat-left" },
  Bottom: { id: "settings-preferences-chat-bottom" },
};

/** Where the pane sits, offered where the viewport divides. */
function PreferencesChatPlacement(): ReactNode {
  const held = useChatPane();
  if (!chatPanePlaceable(held.twoColumn)) return null;
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

/** Only a project's frame has a chat pane, so only there is it placed. */
export function PreferencesChatPosition(): ReactNode {
  const project = useParams({ strict: false }).project;
  return project === undefined ? null : <PreferencesChatPlacement />;
}

/** Each section, in the order the page draws them. */
const preferencesSections: readonly (() => ReactNode)[] = [
  PreferencesAppearance,
  PreferencesWording,
  PreferencesChatPosition,
];

export function PreferencesPage(): ReactNode {
  const text = useCopyText();
  return (
    <SettingsPage title={text({ id: "settings-nav-preferences" })}>
      <div className="preferences">
        {preferencesSections.map((Section, at) => (
          <Section key={at} />
        ))}
      </div>
    </SettingsPage>
  );
}
