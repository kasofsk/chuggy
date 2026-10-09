/**
 * The abilities read as a case scripts it: a reader who may press every door,
 * one who may press none, and the route that answers either.
 */

import { screen } from "@testing-library/react";

import type { ProjectAbilitiesResponse } from "../../../src/contract/responses.ts";
import { answer } from "./screenHarness.tsx";

export const abilitiesEvery: ProjectAbilitiesResponse = {
  mutate: true,
  dispatch: true,
  manageSelector: true,
  administer: true,
};

export const abilitiesNone: ProjectAbilitiesResponse = {
  mutate: false,
  dispatch: false,
  manageSelector: false,
  administer: false,
};

/** Whether a request is the abilities read. */
export function abilitiesAsked(url: string): boolean {
  return url.endsWith("/abilities");
}

/** A read that is never answered, which is what the abilities read is to a
 * case about the console before it knows. */
export function unanswered(): Promise<Response> {
  return new Promise<Response>(() => undefined);
}

/** The abilities read's answer, and nothing for any other route's request. */
export function abilitiesAnswered(
  url: string,
  abilities: ProjectAbilitiesResponse,
): Response | undefined {
  return abilitiesAsked(url) ? answer(abilities) : undefined;
}

/** What a case has the abilities read answer: a body, nothing ever, or an
 * answer the case lets go when it chooses. */
export type AbilitiesAnswer =
  ProjectAbilitiesResponse | undefined | Promise<Response>;

/** A fetch that answers the abilities read as the case says and hands every
 * other request to `served`. */
export function abilitiesFetch(
  abilities: AbilitiesAnswer,
  served: typeof fetch,
): typeof fetch {
  return ((url: string, init?: RequestInit) => {
    if (!abilitiesAsked(url)) return served(url, init);
    if (abilities instanceof Promise) return abilities;
    return abilities === undefined
      ? unanswered()
      : Promise.resolve(answer(abilities));
  }) as typeof fetch;
}

/** What lays `abilitiesFetch` over a case's own `fetch`. */
export function abilitiesOver(
  abilities: AbilitiesAnswer,
): (served: typeof fetch) => typeof fetch {
  return (served) => abilitiesFetch(abilities, served);
}

/** The readers a control stays drawn for, each with how a case names it: one
 * the read said yes to, and one it has not answered for. */
export const abilitiesUnrefusing: readonly (readonly [
  string,
  ProjectAbilitiesResponse | undefined,
])[] = [
  ["said may", abilitiesEvery],
  ["has not answered for", undefined],
];

/** `served`, keeping the address of every request it was sent, so a case can
 * say a read was never asked for. */
export function addressesKept(served: typeof fetch): {
  readonly fetch: typeof fetch;
  readonly sentTo: (part: string) => number;
} {
  const sent: string[] = [];
  return {
    fetch: ((url: string, init?: RequestInit) => {
      sent.push(url);
      return served(url, init);
    }) as typeof fetch,
    sentTo: (part) => sent.filter((url) => url.includes(part)).length,
  };
}

/** What the Draft panel of a screen that writes a draft reads as, its title
 * and its body run together. */
export function draftPanelText(): string | null {
  return screen.getByRole("region", { name: "Draft" }).textContent;
}
