/**
 * What a project's Appearance settings say and offer: the default theme's
 * picker and what it marks, and the icon and the banner, each file checked
 * against its role's types and bound before it is uploaded, and each refusal,
 * the console's or the server's, said in the same words.
 *
 * THE PROJECT KEEPS A COPY. Its default theme is a document, not a reference
 * to the theme it was chosen from, so the picker marks the option whose
 * document is the one kept. Where no option's is, the kept document is a card
 * of its own; and where it carries the name of exactly one theme of the
 * reader's own whose document is not the kept one, that theme is the one the
 * project's can be updated from.
 */

import type { ThemeDocument } from "../../../../src/contract/appearance.ts";
import {
  projectImageBytesMax,
  projectImageMediaTypes,
} from "../../../../src/contract/http.ts";
import type { ProjectImageRole } from "../../../../src/contract/http.ts";
import type {
  ProjectArtifactUploadRefusalCode,
  ProjectImageRefusalCode,
} from "../../../../src/contract/rosters.ts";

import type { ApiFailure } from "./apiRequest.ts";
import type { Copy } from "./copy.ts";
import { failureWords } from "./failureWords.ts";
import { bytesSetFigure } from "./figures.ts";
import type { ThemePickerOption } from "./themePreferences.ts";

/** The picker's option keeping no default, so each person sees their own. */
export const projectThemeNone = "none";

/** The picker's card for a kept document no option is. */
export const projectThemeKept = "kept";

/** What the default theme's picker marks and offers beyond its options. */
export interface ProjectThemeSettings {
  readonly chosen: string;
  /** The kept document, drawn as a card of its own where no option is it. */
  readonly kept: ThemeDocument | undefined;
  /** The reader's own theme the kept one carries the name of and differs from. */
  readonly drifted: ThemePickerOption | undefined;
}

/** A document as JSON with every object's keys in order, so two documents
 * holding the same values read the same however each was built. */
function projectThemeText(theme: ThemeDocument): string {
  return JSON.stringify(theme, (_key, value: unknown) =>
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
        )
      : value,
  );
}

export function projectThemesSame(a: ThemeDocument, b: ThemeDocument): boolean {
  return projectThemeText(a) === projectThemeText(b);
}

export function projectThemeSettingsOf(
  kept: ThemeDocument | undefined,
  options: readonly ThemePickerOption[],
): ProjectThemeSettings {
  if (kept === undefined)
    return { chosen: projectThemeNone, kept: undefined, drifted: undefined };
  const same = options.find((option) => projectThemesSame(option.theme, kept));
  const named = options.filter(
    (option) =>
      option.choice.kind === "Owned" && option.theme.name === kept.name,
  );
  const drifted =
    named.length === 1 && named[0] !== same ? named[0] : undefined;
  return same === undefined
    ? { chosen: projectThemeKept, kept, drifted }
    : { chosen: same.key, kept: undefined, drifted };
}

/** What a default theme's write says once it has landed. */
export function projectThemeLanded(theme: ThemeDocument | undefined): Copy {
  return theme === undefined
    ? { id: "settings-appearance-theme-cleared" }
    : { id: "settings-appearance-theme-saved" };
}

/** Why a default theme's write was refused, in the words every refusal is
 * drawn in. */
export function projectThemeRefusalOf(failure: ApiFailure): Copy {
  return {
    id: "failure-joined",
    args: {
      lead: { id: "settings-appearance-theme-unsaved" },
      rest: failureWords(failure).word,
    },
  };
}

export type ProjectImageMediaType = (typeof projectImageMediaTypes)[number];

/** The types an icon or a banner may be, as a reader names them. */
export const projectImageTypesLabel = projectImageMediaTypes
  .map((type) => type.replace(/^image\//u, "").toUpperCase())
  .join(", ");

/** The most a role's file may hold, in the largest unit stating it whole. */
function projectImageSize(role: ProjectImageRole): Copy {
  const figure = bytesSetFigure(projectImageBytesMax[role]);
  if (figure.kind !== "Quantity")
    throw new Error("a size is stated as a quantity");
  return {
    id: "settings-appearance-image-size",
    args: { count: figure.text, unit: figure.unit },
  };
}

const projectImageHints = {
  icon: "settings-appearance-icon-hint",
  banner: "settings-appearance-banner-hint",
} as const satisfies Readonly<Record<ProjectImageRole, string>>;

/** The types a role takes, its bound, and the shape that suits it. */
export function projectImageHint(role: ProjectImageRole): Copy {
  return {
    id: projectImageHints[role],
    args: { types: projectImageTypesLabel, size: projectImageSize(role) },
  };
}

function projectImageTypeRefused(): Copy {
  return {
    id: "settings-appearance-image-type",
    args: { types: projectImageTypesLabel },
  };
}

function projectImageSizeRefused(role: ProjectImageRole): Copy {
  return {
    id: "settings-appearance-image-large",
    args: { size: projectImageSize(role) },
  };
}

/** What a file offered for a role is uploaded as, or why it is refused
 * before anything is sent. */
export type ProjectImageOffer =
  | { readonly kind: "Taken"; readonly mediaType: ProjectImageMediaType }
  | { readonly kind: "Refused"; readonly refused: Copy };

export function projectImageOffered(
  role: ProjectImageRole,
  file: { readonly type: string; readonly size: number },
): ProjectImageOffer {
  const mediaType = projectImageMediaTypes.find((type) => type === file.type);
  if (mediaType === undefined)
    return { kind: "Refused", refused: projectImageTypeRefused() };
  if (file.size > projectImageBytesMax[role])
    return { kind: "Refused", refused: projectImageSizeRefused(role) };
  return { kind: "Taken", mediaType };
}

type ProjectImageCode =
  ProjectImageRefusalCode | ProjectArtifactUploadRefusalCode;

/** The upload's and the naming's refusals of a file's type, and of its size. */
const projectImageTypeCodes: readonly string[] = [
  "ImageTypeNotAdmitted",
  "UnsupportedMediaType",
] satisfies readonly ProjectImageCode[];

const projectImageSizeCodes: readonly string[] = [
  "ImageTooLarge",
  "ArtifactTooLarge",
] satisfies readonly ProjectImageCode[];

/** Why the server refused an upload or a naming: a type or a size in the
 * words the console refuses one in before sending, anything else in the
 * words every refusal is drawn in. */
export function projectImageRefusalOf(
  role: ProjectImageRole,
  failure: ApiFailure,
): Copy {
  if (failure.outcome === "Rejected") {
    if (projectImageTypeCodes.includes(failure.code))
      return projectImageTypeRefused();
    if (projectImageSizeCodes.includes(failure.code))
      return projectImageSizeRefused(role);
  }
  return {
    id: "failure-joined",
    args: {
      lead: { id: "settings-appearance-image-unsaved" },
      rest: failureWords(failure).word,
    },
  };
}

const projectImageLandings = {
  icon: {
    saved: "settings-appearance-icon-saved",
    cleared: "settings-appearance-icon-cleared",
  },
  banner: {
    saved: "settings-appearance-banner-saved",
    cleared: "settings-appearance-banner-cleared",
  },
} as const;

/** What an image's write says once it has landed. */
export function projectImageLanded(
  role: ProjectImageRole,
  named: boolean,
): Copy {
  const words = projectImageLandings[role];
  return { id: named ? words.saved : words.cleared };
}
