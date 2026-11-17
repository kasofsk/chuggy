/**
 * What the theme controls of Preferences say and hold, from the reader's
 * global choice and, inside a project, the project's resolved read: which
 * option each picker marks, which layer applies in the project and why, and
 * whether the project's default is what keeps the global choice from showing.
 *
 * A choice is resolved here as the server resolves it, highest first: the
 * reader's own for the project, the project's default, their global choice,
 * the built-in default; a layer naming a theme of theirs that is not among
 * `owned` counts as unset. That is what lets a choice be worn as it is made,
 * before the write that keeps it has answered.
 */

import {
  builtInThemeDefault,
  builtInThemeIds,
  builtInThemes,
} from "../../../../src/contract/appearance.ts";
import type {
  ThemeChoice,
  ThemeDocument,
  ThemeLayer,
} from "../../../../src/contract/appearance.ts";
import type {
  OwnedThemeResponse,
  ProjectAppearanceResponse,
} from "../../../../src/contract/responses.ts";

import type { ApiFailure } from "./apiRequest.ts";
import type { Copy } from "./copy.ts";
import { failureWords } from "./failureWords.ts";

/** The project picker's one option beyond the themes, clearing the reader's
 * own choice for the project. */
export const themePickerProjectDefault = "project-default";

/** One theme a picker offers: the key it is held by, the choice it writes,
 * and the document its swatch is drawn from. */
export interface ThemePickerOption {
  readonly key: string;
  readonly choice: ThemeChoice;
  readonly theme: ThemeDocument;
}

export function themePickerKeyOf(choice: ThemeChoice): string {
  switch (choice.kind) {
    case "BuiltIn":
      return `built-in:${choice.theme}`;
    case "Owned":
      return `owned:${String(choice.theme)}`;
  }
}

/** The built-ins in the contract's order, then the reader's own by number. */
export function themePickerOptions(
  owned: readonly OwnedThemeResponse[],
): readonly ThemePickerOption[] {
  const choices: readonly (readonly [ThemeChoice, ThemeDocument])[] = [
    ...builtInThemeIds.map((theme): [ThemeChoice, ThemeDocument] => [
      { kind: "BuiltIn", theme },
      builtInThemes[theme],
    ]),
    ...owned.map((held): [ThemeChoice, ThemeDocument] => [
      { kind: "Owned", theme: held.theme },
      held.document,
    ]),
  ];
  return choices.map(([choice, theme]) => ({
    key: themePickerKeyOf(choice),
    choice,
    theme,
  }));
}

/** The document a choice names, none where it names a theme not owned. */
function themeResolvedDocument(
  choice: ThemeChoice | undefined,
  owned: readonly OwnedThemeResponse[],
): ThemeDocument | undefined {
  if (choice === undefined) return undefined;
  switch (choice.kind) {
    case "BuiltIn":
      return builtInThemes[choice.theme];
    case "Owned":
      return owned.find((held) => held.theme === choice.theme)?.document;
  }
}

/** The project's read once the reader's own layers are `layers`, resolved
 * through every layer again. */
export function themeResolvedOf(
  layers: ProjectAppearanceResponse["layers"],
  owned: readonly OwnedThemeResponse[],
): ProjectAppearanceResponse {
  const override = themeResolvedDocument(layers.override, owned);
  const global = themeResolvedDocument(layers.global, owned);
  const kept: ProjectAppearanceResponse["layers"] = {
    ...(override === undefined || layers.override === undefined
      ? {}
      : { override: layers.override }),
    ...(layers.projectDefault === undefined
      ? {}
      : { projectDefault: layers.projectDefault }),
    ...(global === undefined || layers.global === undefined
      ? {}
      : { global: layers.global }),
  };
  const [theme, layer]: readonly [ThemeDocument, ThemeLayer] =
    override !== undefined
      ? [override, "ProjectOverride"]
      : layers.projectDefault !== undefined
        ? [layers.projectDefault, "ProjectDefault"]
        : global !== undefined
          ? [global, "Global"]
          : [builtInThemes[builtInThemeDefault], "BuiltInDefault"];
  return { theme, layer, layers: kept };
}

/** The project's read with the reader's own choice for it set, or cleared
 * where `override` is none. */
export function themeOverrideChosen(
  appearance: ProjectAppearanceResponse,
  override: ThemeChoice | undefined,
  owned: readonly OwnedThemeResponse[],
): ProjectAppearanceResponse {
  const { projectDefault, global } = appearance.layers;
  return themeResolvedOf(
    {
      ...(override === undefined ? {} : { override }),
      ...(projectDefault === undefined ? {} : { projectDefault }),
      ...(global === undefined ? {} : { global }),
    },
    owned,
  );
}

/** The project's read with the reader's global choice set. */
export function themeGlobalChosen(
  appearance: ProjectAppearanceResponse,
  global: ThemeChoice,
  owned: readonly OwnedThemeResponse[],
): ProjectAppearanceResponse {
  return themeResolvedOf({ ...appearance.layers, global }, owned);
}

const themePreferencesHere: Readonly<
  Record<
    ThemeLayer,
    | "settings-preferences-theme-here-override"
    | "settings-preferences-theme-here-default"
    | "settings-preferences-theme-here-global"
    | "settings-preferences-theme-here-built-in"
  >
> = {
  ProjectOverride: "settings-preferences-theme-here-override",
  ProjectDefault: "settings-preferences-theme-here-default",
  Global: "settings-preferences-theme-here-global",
  BuiltInDefault: "settings-preferences-theme-here-built-in",
};

/** What the theme controls say and mark. */
export interface ThemePreferences {
  readonly global: {
    readonly chosen: string;
    /** Why the global choice does not show here, where a project's default
     * is what applies. */
    readonly covered: Copy | undefined;
  };
  /** The row for the project the reader is in, none outside every project:
   * the theme that applies there by its name, which is data, and why. */
  readonly project:
    | {
        readonly chosen: string;
        readonly applies: string;
        readonly because: Copy;
      }
    | undefined;
}

/** The global picker marks the reader's choice, and the built-in default
 * where they hold none, since that is what they are shown. */
export function themePreferencesOf(
  global: ThemeChoice | undefined,
  appearance: ProjectAppearanceResponse | undefined,
): ThemePreferences {
  return {
    global: {
      chosen: themePickerKeyOf(
        global ?? { kind: "BuiltIn", theme: builtInThemeDefault },
      ),
      covered:
        appearance?.layer === "ProjectDefault"
          ? { id: "settings-preferences-theme-covered" }
          : undefined,
    },
    project:
      appearance === undefined
        ? undefined
        : {
            chosen:
              appearance.layers.override === undefined
                ? themePickerProjectDefault
                : themePickerKeyOf(appearance.layers.override),
            applies: appearance.theme.name,
            because: { id: themePreferencesHere[appearance.layer] },
          },
  };
}

/** Why a theme write was refused: a theme no longer the reader's by name,
 * anything else in the words every refusal is drawn in. */
export function themeRefusalOf(failure: ApiFailure): Copy {
  const rest: Copy =
    failure.outcome === "Rejected" && failure.code === "ThemeNotFound"
      ? { id: "settings-preferences-theme-not-found" }
      : failureWords(failure).word;
  return {
    id: "failure-joined",
    args: { lead: { id: "settings-preferences-theme-unsaved" }, rest },
  };
}

/** The theme in use where the reader is, and the theme of theirs it is,
 * where it is one: inside a project its resolved theme, outside every one
 * their global choice. The editor copies the first and edits the second. */
export function themeInUseOf(
  global: ThemeChoice | undefined,
  appearance: ProjectAppearanceResponse | undefined,
  owned: readonly OwnedThemeResponse[],
): {
  readonly theme: ThemeDocument;
  readonly own: OwnedThemeResponse | undefined;
} {
  const choice =
    appearance === undefined
      ? global
      : appearance.layer === "ProjectOverride"
        ? appearance.layers.override
        : appearance.layer === "Global"
          ? appearance.layers.global
          : undefined;
  const own =
    choice?.kind === "Owned"
      ? owned.find((held) => held.theme === choice.theme)
      : undefined;
  return {
    theme:
      appearance?.theme ??
      themeResolvedDocument(global, owned) ??
      builtInThemes[builtInThemeDefault],
    own,
  };
}
