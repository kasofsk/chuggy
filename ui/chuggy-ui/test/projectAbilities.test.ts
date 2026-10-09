/**
 * What the abilities read decides: a door is refused only where the read said
 * no, granted only where it said yes, and a read behind a door is held until
 * the abilities read has settled.
 */

import { expect, test } from "vitest";

import {
  projectAbilityGranted,
  projectAbilityRead,
  projectAbilityRefused,
} from "../app/core/projectAbilities.ts";
import type { ProjectAbility } from "../app/core/projectAbilities.ts";
import { abilitiesEvery, abilitiesNone } from "./projectAbilitiesFixture.ts";

const abilities: readonly ProjectAbility[] = [
  "mutate",
  "dispatch",
  "manageSelector",
  "administer",
];

test("a door is refused only where the read answered no", () => {
  for (const ability of abilities) {
    expect(projectAbilityRefused(abilitiesNone, ability)).toBe(true);
    expect(projectAbilityRefused(abilitiesEvery, ability)).toBe(false);
    expect(projectAbilityRefused(undefined, ability)).toBe(false);
  }
});

test("each door is refused by its own answer and no other's", () => {
  for (const refused of abilities) {
    const one = { ...abilitiesEvery, [refused]: false };
    expect(
      abilities.filter((ability) => projectAbilityRefused(one, ability)),
    ).toStrictEqual([refused]);
  }
});

test("a door is granted only where the read answered yes", () => {
  for (const ability of abilities) {
    expect(projectAbilityGranted(abilitiesEvery, ability)).toBe(true);
    expect(projectAbilityGranted(abilitiesNone, ability)).toBe(false);
    expect(projectAbilityGranted(undefined, ability)).toBe(false);
  }
});

test("a read behind a door is held until the abilities read settles", () => {
  expect(projectAbilityRead(undefined, false, "mutate")).toBe("Held");
});

test("a read behind a door is asked where the abilities read settled with no answer", () => {
  expect(projectAbilityRead(undefined, true, "mutate")).toBe("Asked");
});

test("a read behind a door is asked on a yes and refused on a no", () => {
  expect(projectAbilityRead(abilitiesEvery, true, "mutate")).toBe("Asked");
  expect(projectAbilityRead(abilitiesNone, true, "mutate")).toBe("Refused");
  expect(
    projectAbilityRead({ ...abilitiesNone, mutate: true }, true, "mutate"),
  ).toBe("Asked");
});
