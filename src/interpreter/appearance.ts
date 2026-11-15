/**
 * A person's own appearance: the themes they made and the one theme they
 * chose for every console they sign in to.
 *
 * EVERY CALL IS THE CALLER'S OWN. Each is handed the principal its request
 * authenticated as and names no other, so no person reads, writes or chooses
 * another's theme; a number another person owns is answered as one nobody
 * owns.
 *
 * A DOCUMENT IS REFUSED HERE BEFORE IT IS KEPT where the contract's contrast
 * rule finds a pair it draws too faintly, so the console computing the same
 * rule is a courtesy and never the control. A theme that is deleted takes the
 * choice naming it with it, so that choice reads as none.
 */

import {
  themeContrastFailures,
  themesOwnedMax,
  type ThemeChoice,
  type ThemeContrastFailure,
  type ThemeDocument,
} from "../contract/appearance.ts";
import type { Principal } from "./principal.ts";

export interface OwnedTheme {
  readonly theme: number;
  readonly document: ThemeDocument;
}

/** A document the contrast rule refuses, with every pair it draws too faintly. */
export interface ThemeContrastRefused {
  readonly result: "ContrastInsufficient";
  readonly failures: readonly ThemeContrastFailure[];
}

export type OwnedThemeCreated =
  | { readonly result: "Created"; readonly theme: OwnedTheme }
  | { readonly result: "LimitReached" }
  | ThemeContrastRefused;

export type OwnedThemeWritten =
  | { readonly result: "Written" }
  | { readonly result: "NotFound" }
  | ThemeContrastRefused;

export type OwnedThemeDeleted = "Deleted" | "NotFound";

/** A choice written, or refused because the theme it names is not the caller's. */
export type ThemeChosen = "Chosen" | "ThemeNotFound";

/**
 * Where a person's appearance is kept. A creation past `themesMax` of theirs
 * keeps nothing and answers none, and a choice naming a theme of someone
 * else's, or of nobody's, keeps nothing and answers false.
 */
export interface AppearanceStore {
  themes(principal: Principal): Promise<readonly OwnedTheme[]>;
  theme(principal: Principal, theme: number): Promise<OwnedTheme | undefined>;
  create(
    principal: Principal,
    document: ThemeDocument,
    themesMax: number,
  ): Promise<number | undefined>;
  write(
    principal: Principal,
    theme: number,
    document: ThemeDocument,
  ): Promise<boolean>;
  delete(principal: Principal, theme: number): Promise<boolean>;
  choice(principal: Principal): Promise<ThemeChoice | undefined>;
  choose(
    principal: Principal,
    choice: ThemeChoice | undefined,
  ): Promise<boolean>;
}

export interface AppearanceService {
  themes(principal: Principal): Promise<readonly OwnedTheme[]>;
  theme(principal: Principal, theme: number): Promise<OwnedTheme | undefined>;
  create(
    principal: Principal,
    document: ThemeDocument,
  ): Promise<OwnedThemeCreated>;
  write(
    principal: Principal,
    theme: number,
    document: ThemeDocument,
  ): Promise<OwnedThemeWritten>;
  delete(principal: Principal, theme: number): Promise<OwnedThemeDeleted>;
  choice(principal: Principal): Promise<ThemeChoice | undefined>;
  choose(
    principal: Principal,
    choice: ThemeChoice | undefined,
  ): Promise<ThemeChosen>;
}

/** The refusal the contrast rule makes of `document`, or none where it passes. */
function appearanceContrastRefused(
  document: ThemeDocument,
): ThemeContrastRefused | undefined {
  const failures = themeContrastFailures(document);
  return failures.length === 0
    ? undefined
    : { result: "ContrastInsufficient", failures };
}

/** The caller's own appearance over `store`, every document held to the contrast rule before it is kept. */
export function appearanceService(store: AppearanceStore): AppearanceService {
  return {
    themes: (principal) => store.themes(principal),
    theme: (principal, theme) => store.theme(principal, theme),
    create: async (principal, document) => {
      const refused = appearanceContrastRefused(document);
      if (refused !== undefined) return refused;
      const theme = await store.create(principal, document, themesOwnedMax);
      return theme === undefined
        ? { result: "LimitReached" }
        : { result: "Created", theme: { theme, document } };
    },
    write: async (principal, theme, document) => {
      const refused = appearanceContrastRefused(document);
      if (refused !== undefined) return refused;
      return (await store.write(principal, theme, document))
        ? { result: "Written" }
        : { result: "NotFound" };
    },
    delete: async (principal, theme) =>
      (await store.delete(principal, theme)) ? "Deleted" : "NotFound",
    choice: (principal) => store.choice(principal),
    choose: async (principal, choice) =>
      (await store.choose(principal, choice)) ? "Chosen" : "ThemeNotFound",
  };
}
