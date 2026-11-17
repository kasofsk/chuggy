/**
 * What the theme editor decides: the roles it shows and in which groups, the
 * draft it edits and whether that differs from where it started, each pairing
 * the contract's contrast rule checks with its ratio, the nearest value that
 * passes for a role that fails, and whether the draft may be saved.
 *
 * A draft carries both schemes, so a theme made here is always `Both`. A
 * colour field holds what was typed; a text that reads as no colour is kept
 * beside the draft rather than in it, so the draft is always a theme and the
 * field that does not read blocks saving until it does. Whether a pairing
 * passes is the contract's `themeContrastFailures`, whose verdict the server
 * repeats before it keeps anything.
 */

import {
  contrastRatio,
  themeColourSchema,
  themeContrastFailures,
  themeContrastPairs,
  themeFillColour,
  themeFills,
  themeFixedColours,
  themeNameSchema,
  themeRoles,
  themeSchemes,
  themeWashColour,
  themeWashes,
} from "../../../../src/contract/appearance.ts";
import type {
  ThemeColours,
  ThemeContrastFailure,
  ThemeContrastPair,
  ThemeDocument,
  ThemeFill,
  ThemeFixedRole,
  ThemeFont,
  ThemeRole,
  ThemeScheme,
  ThemeTextSize,
  ThemeWash,
} from "../../../../src/contract/appearance.ts";

import { themeColoursOf } from "./themeTokens.ts";

export const themeEditorGroups = [
  "Surfaces",
  "Text",
  "Edges",
  "Accent",
] as const;
export type ThemeEditorGroup = (typeof themeEditorGroups)[number];

/** The group each role of the contract's roster is shown in. */
export const themeEditorRoleGroups: Readonly<
  Record<ThemeRole, ThemeEditorGroup>
> = {
  "surface-0": "Surfaces",
  "surface-1": "Surfaces",
  "surface-2": "Surfaces",
  "surface-inverse": "Surfaces",
  bubble: "Surfaces",
  "ink-1": "Text",
  "ink-2": "Text",
  "ink-3": "Text",
  "ink-inverse": "Text",
  edge: "Edges",
  "edge-strong": "Edges",
  "edge-control": "Edges",
  accent: "Accent",
  "ink-on-accent": "Accent",
};

/** The roles that give the console its character, shown before the rest. */
export const themeEditorRolesLead: readonly ThemeRole[] = [
  "surface-0",
  "surface-1",
  "ink-1",
  "accent",
  "ink-on-accent",
];

export interface ThemeEditorRoleGroup {
  readonly group: ThemeEditorGroup;
  readonly roles: readonly ThemeRole[];
}

/** The lead roles, or the rest, by group in the roster's order; a group
 * with none of them is left out. */
export function themeEditorGroupsOf(
  lead: boolean,
): readonly ThemeEditorRoleGroup[] {
  return themeEditorGroups
    .map((group) => ({
      group,
      roles: themeRoles.filter(
        (role) =>
          themeEditorRoleGroups[role] === group &&
          themeEditorRolesLead.includes(role) === lead,
      ),
    }))
    .filter((held) => held.roles.length > 0);
}

/** A theme as the editor holds it: both schemes' colours, always. */
export interface ThemeDraft {
  readonly name: string;
  readonly colours: Readonly<Record<ThemeScheme, ThemeColours>>;
  readonly textSize: ThemeTextSize;
  readonly font: ThemeFont;
}

/** A copy of `theme` under `name`, a scheme it does not carry being the
 * sheet's, which is what the console draws for it. */
export function themeDraftOf(theme: ThemeDocument, name: string): ThemeDraft {
  return {
    name,
    colours: {
      Light: themeColoursOf(theme, "Light"),
      Dark: themeColoursOf(theme, "Dark"),
    },
    textSize: theme.textSize,
    font: theme.font,
  };
}

/** The document a draft is saved as, its name trimmed. */
export function themeDraftDocument(draft: ThemeDraft): ThemeDocument {
  return {
    name: draft.name.trim(),
    palette: {
      schemes: "Both",
      light: draft.colours.Light,
      dark: draft.colours.Dark,
    },
    textSize: draft.textSize,
    font: draft.font,
  };
}

/** A colour field's text that reads as no colour, kept until it does. */
export interface ThemeEditorUnread {
  readonly scheme: ThemeScheme;
  readonly role: ThemeRole;
  readonly typed: string;
}

/** What the editor holds: where it started, the draft, and the fields whose
 * text reads as no colour. */
export interface ThemeEditing {
  readonly start: ThemeDraft;
  readonly draft: ThemeDraft;
  readonly unread: readonly ThemeEditorUnread[];
}

export function themeEditingOf(start: ThemeDraft): ThemeEditing {
  return { start, draft: start, unread: [] };
}

/** A colour as the contract writes one, from what was typed: any case, with
 * or without its `#`; none where it is not six hex digits. */
export function themeEditorColourRead(typed: string): string | undefined {
  const written = typed.trim().toLowerCase();
  const hashed = written.startsWith("#") ? written : `#${written}`;
  return themeColourSchema.safeParse(hashed).success ? hashed : undefined;
}

/** The editing with `typed` in the field of `role` in `scheme`: put in the
 * draft where it reads as a colour, kept beside it where it does not. */
export function themeEditingColourTyped(
  editing: ThemeEditing,
  scheme: ThemeScheme,
  role: ThemeRole,
  typed: string,
): ThemeEditing {
  const unread = editing.unread.filter(
    (held) => held.scheme !== scheme || held.role !== role,
  );
  const colour = themeEditorColourRead(typed);
  if (colour === undefined)
    return { ...editing, unread: [...unread, { scheme, role, typed }] };
  const colours = editing.draft.colours;
  return {
    ...editing,
    unread,
    draft: {
      ...editing.draft,
      colours: {
        ...colours,
        [scheme]: { ...colours[scheme], [role]: colour },
      },
    },
  };
}

/** What a colour field shows: what was typed where it reads as no colour,
 * the draft's colour otherwise. */
export function themeEditingColourText(
  editing: ThemeEditing,
  scheme: ThemeScheme,
  role: ThemeRole,
): string {
  return (
    editing.unread.find((held) => held.scheme === scheme && held.role === role)
      ?.typed ?? editing.draft.colours[scheme][role]
  );
}

function themeEditorDraftsSame(first: ThemeDraft, second: ThemeDraft): boolean {
  return (
    first.name === second.name &&
    first.textSize === second.textSize &&
    first.font === second.font &&
    themeSchemes.every((scheme) =>
      themeRoles.every(
        (role) => first.colours[scheme][role] === second.colours[scheme][role],
      ),
    )
  );
}

/** Whether anything was changed since the editor opened, a field that reads
 * as no colour included. */
export function themeEditingDirty(editing: ThemeEditing): boolean {
  return (
    editing.unread.length > 0 ||
    !themeEditorDraftsSame(editing.start, editing.draft)
  );
}

/** Whether the name is one the contract keeps. */
export function themeEditorNamed(name: string): boolean {
  return themeNameSchema.safeParse(name.trim()).success;
}

/** The role of the draft a pairing is changed by: its foreground where the
 * theme sets that, else its ground, a wash being its panel's and a fill its
 * page's. */
export function themeEditorContrastRole(pair: ThemeContrastPair): ThemeRole {
  const role = (colour: string): ThemeRole | undefined =>
    themeRoles.find((held) => held === colour);
  const foreground = role(pair.foreground);
  if (foreground !== undefined) return foreground;
  const background = role(pair.background);
  if (background !== undefined) return background;
  return themeWashes.some((wash) => wash === pair.background)
    ? "surface-1"
    : "surface-0";
}

function themeEditorSchemeColour(
  scheme: ThemeScheme,
  colours: ThemeColours,
  colour: ThemeContrastPair["foreground"] | ThemeContrastPair["background"],
): string {
  if (colour in colours) return colours[colour as ThemeRole];
  if (themeFills.some((fill) => fill === colour))
    return themeFillColour(scheme, colours, colour as ThemeFill);
  if (themeWashes.some((wash) => wash === colour))
    return themeWashColour(scheme, colours, colour as ThemeWash);
  return themeFixedColours[scheme][colour as ThemeFixedRole];
}

/** One pairing as the editor shows it, beside the role that changes it. */
export interface ThemeEditorContrast {
  readonly pair: ThemeContrastPair;
  readonly role: ThemeRole;
  readonly ratio: number;
  readonly passes: boolean;
}

function themeEditorSchemeDocument(
  colours: ThemeColours,
  scheme: ThemeScheme,
): ThemeDocument {
  return {
    name: scheme,
    palette:
      scheme === "Light"
        ? { schemes: "Light", light: colours }
        : { schemes: "Dark", dark: colours },
    textSize: "Standard",
    font: "System",
  };
}

function themeEditorPairKey(pair: ThemeContrastPair): string {
  return `${pair.foreground} ${pair.background}`;
}

function themeEditorFailingKeys(
  colours: ThemeColours,
  scheme: ThemeScheme,
): ReadonlySet<string> {
  return new Set(
    themeContrastFailures(themeEditorSchemeDocument(colours, scheme)).map(
      themeEditorPairKey,
    ),
  );
}

/** Every pairing the contrast rule checks in `scheme`, with its ratio and
 * the contract's verdict on it. */
export function themeEditorContrasts(
  draft: ThemeDraft,
  scheme: ThemeScheme,
): readonly ThemeEditorContrast[] {
  const colours = draft.colours[scheme];
  const failing = themeEditorFailingKeys(colours, scheme);
  return themeContrastPairs.map((pair) => ({
    pair,
    role: themeEditorContrastRole(pair),
    ratio: contrastRatio(
      themeEditorSchemeColour(scheme, colours, pair.foreground),
      themeEditorSchemeColour(scheme, colours, pair.background),
    ),
    passes: !failing.has(themeEditorPairKey(pair)),
  }));
}

/** A ratio as the editor writes it, cut rather than rounded to one place, so
 * a pairing just short of its minimum never reads as meeting it. */
export function themeEditorRatioText(ratio: number): string {
  return (Math.floor(ratio * 10) / 10).toFixed(1);
}

/** The most steps the nearest passing value is looked for in, each way. */
export const themeEditorNearestStepsMax = 100;

type ThemeEditorToward = "Lighter" | "Darker";

/** `colour` moved `percent` of the way to white or to black. */
function themeEditorShifted(
  colour: string,
  toward: ThemeEditorToward,
  percent: number,
): string {
  const end = toward === "Lighter" ? 255 : 0;
  const channels = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(colour.slice(start, start + 2), 16);
    const moved = channel + ((end - channel) * percent) / 100;
    return Math.round(moved).toString(16).padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

/**
 * The value nearest to `role`'s in `scheme` at which no pairing it changes
 * fails and no pairing that passed now fails, moving it towards white or
 * black a step at a time; none where no step within the bound does.
 */
export function themeEditorNearest(
  draft: ThemeDraft,
  scheme: ThemeScheme,
  role: ThemeRole,
): string | undefined {
  const colours = draft.colours[scheme];
  const failing = themeEditorFailingKeys(colours, scheme);
  const changed = new Set(
    themeContrastPairs
      .filter((pair) => themeEditorContrastRole(pair) === role)
      .map(themeEditorPairKey),
  );
  for (let step = 1; step <= themeEditorNearestStepsMax; step += 1)
    for (const toward of ["Lighter", "Darker"] as const) {
      const candidate = themeEditorShifted(colours[role], toward, step);
      if (candidate === colours[role]) continue;
      const after = themeEditorFailingKeys(
        { ...colours, [role]: candidate },
        scheme,
      );
      if ([...after].every((key) => failing.has(key) && !changed.has(key)))
        return candidate;
    }
  return undefined;
}

/** Whether the draft may be saved, and where it may not, why. */
export type ThemeEditorSaving =
  | { readonly kind: "Saveable"; readonly document: ThemeDocument }
  | { readonly kind: "Unchanged" }
  | { readonly kind: "Unnamed" }
  | { readonly kind: "Unread" }
  | {
      readonly kind: "Inaccessible";
      readonly failures: readonly ThemeContrastFailure[];
    };

/** A new theme may be saved as it opened, since it is a copy; a theme being
 * edited only once it differs. */
export function themeEditorSavingOf(
  editing: ThemeEditing,
  creating: boolean,
): ThemeEditorSaving {
  if (!creating && !themeEditingDirty(editing)) return { kind: "Unchanged" };
  if (!themeEditorNamed(editing.draft.name)) return { kind: "Unnamed" };
  if (editing.unread.length > 0) return { kind: "Unread" };
  const document = themeDraftDocument(editing.draft);
  const failures = themeContrastFailures(document);
  return failures.length === 0
    ? { kind: "Saveable", document }
    : { kind: "Inaccessible", failures };
}

/** The roles that fail in `scheme`, each once, in the roster's order. */
export function themeEditorFailingRoles(
  draft: ThemeDraft,
  scheme: ThemeScheme,
): readonly ThemeRole[] {
  const failing = themeEditorContrasts(draft, scheme).filter(
    (contrast) => !contrast.passes,
  );
  return themeRoles.filter((role) =>
    failing.some((contrast) => contrast.role === role),
  );
}
