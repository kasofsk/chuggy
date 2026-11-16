/**
 * The theme the console wears, put on the root as the route and the answers
 * say: a project's resolved theme inside it, the reader's global theme outside
 * every project, what was kept for a scope until its answer lands, and a
 * theme below the contrast rule never worn.
 *
 * The suite's document resolves no `light-dark()`, so the cases read the
 * properties set on the root, which is what the rendered harness then draws.
 */

import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type * as RouterModule from "@tanstack/react-router";

import { builtInThemes } from "../../../src/contract/appearance.ts";
import type {
  ThemeChoice,
  ThemeDocument,
} from "../../../src/contract/appearance.ts";
import { ThemeFollowed } from "../app/browser/ThemeFollowed.tsx";
import { SessionProvider } from "../app/browser/session.tsx";
import { themeAssignmentsPut, themeWear } from "../app/browser/themeWorn.ts";
import { persistentStore } from "../app/browser/ports.ts";
import {
  projectAppearanceQuery,
  themeChoiceQuery,
} from "../app/core/themeQueries.ts";
import {
  themeAssignmentsOf,
  themeCacheKey,
  themeCacheWrite,
  themeTokens,
} from "../app/core/themeTokens.ts";
import {
  answer,
  holderDouble,
  queryClientUnretried,
  scriptedFetch,
  settled,
} from "./screenHarness.tsx";
import type { SentRequest } from "./screenHarness.tsx";

let routeParams: { readonly tenant?: string; readonly project?: string } = {};

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof RouterModule>()),
  useParams: () => routeParams,
}));

const atlas = { tenant: "acme", project: "atlas" };
const zephyr = { tenant: "acme", project: "zephyr" };
const harbour = builtInThemes.harbour;
const ember = builtInThemes.ember;
const root = document.documentElement;

afterEach(() => {
  cleanup();
  routeParams = {};
  themeAssignmentsPut(root, []);
  persistentStore.remove(themeCacheKey);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function rootSet(): Readonly<Record<string, string>> {
  return Object.fromEntries(
    themeTokens
      .map((property): [string, string] => [
        property,
        root.style.getPropertyValue(property),
      ])
      .filter(([, value]) => value !== ""),
  );
}

function wornAs(theme: ThemeDocument): Readonly<Record<string, string>> {
  return Object.fromEntries(
    themeAssignmentsOf(theme).map(({ property, value }) => [property, value]),
  );
}

function appearanceOf(theme: ThemeDocument): unknown {
  return { theme, layer: "ProjectDefault", layers: { projectDefault: theme } };
}

/** The answers by path, which a case changes between reads. */
type Answers = Record<string, unknown>;

function answeredFrom(answers: Answers) {
  return (request: SentRequest): Response => {
    const path = new URL(request.url, "http://console.test").pathname;
    const body = answers[path];
    return body === undefined
      ? answer({ error: { code: "NotFound", message: "absent" } }, 404)
      : answer(body);
  };
}

const atlasPath = "/api/v1/tenants/acme/projects/atlas/appearance";
const zephyrPath = "/api/v1/tenants/acme/projects/zephyr/appearance";
const choicePath = "/api/v1/appearance/choice";

async function followed(
  answers: Answers,
): Promise<{ client: QueryClient; redraw: () => void }> {
  vi.stubGlobal("fetch", scriptedFetch(answeredFrom(answers)).fetch);
  const client = queryClientUnretried();
  const tree = (nudge: number) => (
    <SessionProvider holder={holderDouble()}>
      <QueryClientProvider client={client}>
        <span>{nudge}</span>
        <ThemeFollowed />
      </QueryClientProvider>
    </SessionProvider>
  );
  const view = render(tree(0));
  await settled();
  let nudge = 0;
  return {
    client,
    redraw: () => {
      nudge += 1;
      view.rerender(tree(nudge));
    },
  };
}

test("the assignments are set on the root's own style and a put of none takes every one off", () => {
  themeAssignmentsPut(root, themeAssignmentsOf(harbour));
  expect(rootSet()).toStrictEqual(wornAs(harbour));
  expect(root.hasAttribute("style")).toBe(true);
  themeAssignmentsPut(root, []);
  expect(rootSet()).toStrictEqual({});
});

test("inside a project the resolved theme is worn and kept for that project", async () => {
  routeParams = atlas;
  await followed({ [atlasPath]: appearanceOf(harbour) });
  expect(rootSet()).toStrictEqual(wornAs(harbour));
  themeAssignmentsPut(root, []);
  themeWear(root, persistentStore, atlas, undefined);
  expect(rootSet()).toStrictEqual(wornAs(harbour));
  themeWear(root, persistentStore, zephyr, undefined);
  expect(rootSet()).toStrictEqual({});
});

test("the built-in default resolved wears nothing, so the console is the sheet alone", async () => {
  routeParams = atlas;
  themeAssignmentsPut(root, themeAssignmentsOf(harbour));
  await followed({
    [atlasPath]: {
      theme: builtInThemes.chuggy,
      layer: "BuiltInDefault",
      layers: {},
    },
  });
  expect(rootSet()).toStrictEqual({});
  expect(persistentStore.read(themeCacheKey)).toBeNull();
});

test("a project switched to wears what was kept for it until its own answer lands, and never the last project's", async () => {
  themeCacheWrite(persistentStore, zephyr, themeAssignmentsOf(ember));
  routeParams = atlas;
  const answers: Answers = { [atlasPath]: appearanceOf(harbour) };
  const { redraw } = await followed(answers);
  expect(rootSet()).toStrictEqual(wornAs(harbour));
  routeParams = zephyr;
  act(redraw);
  expect(rootSet()).toStrictEqual(wornAs(ember));
  answers[zephyrPath] = {
    theme: builtInThemes.chuggy,
    layer: "BuiltInDefault",
    layers: {},
  };
  await settled();
  expect(rootSet()).toStrictEqual({});
});

test("a theme write landing is worn as its answer lands", async () => {
  routeParams = atlas;
  const answers: Answers = { [atlasPath]: appearanceOf(harbour) };
  const { client } = await followed(answers);
  answers[atlasPath] = appearanceOf(ember);
  await act(() =>
    client.invalidateQueries({
      queryKey: projectAppearanceQuery(atlas).queryKey,
    }),
  );
  await settled();
  expect(rootSet()).toStrictEqual(wornAs(ember));
});

test("outside every project the reader's global choice is worn: a built-in by its id, and one of theirs by its document", async () => {
  const answers: Answers = {
    [choicePath]: { choice: { kind: "BuiltIn", theme: "ember" } },
  };
  const { client } = await followed(answers);
  expect(rootSet()).toStrictEqual(wornAs(ember));
  const owned: ThemeChoice = { kind: "Owned", theme: 7 };
  answers[choicePath] = { choice: owned };
  answers["/api/v1/appearance/themes/7"] = { theme: 7, document: harbour };
  await act(() =>
    client.invalidateQueries({ queryKey: themeChoiceQuery().queryKey }),
  );
  await settled();
  expect(rootSet()).toStrictEqual(wornAs(harbour));
  answers[choicePath] = {};
  await act(() =>
    client.invalidateQueries({ queryKey: themeChoiceQuery().queryKey }),
  );
  await settled();
  expect(rootSet()).toStrictEqual({});
});

test("a theme below the contrast rule is never worn, and the refusal is said once however often it is answered", async () => {
  if (harbour.palette.schemes !== "Both")
    throw new Error("Harbour carries both schemes");
  const faint: ThemeDocument = {
    ...harbour,
    palette: {
      ...harbour.palette,
      dark: { ...harbour.palette.dark, "ink-1": harbour.palette.dark.edge },
    },
  };
  const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  routeParams = atlas;
  themeCacheWrite(persistentStore, atlas, themeAssignmentsOf(ember));
  const { redraw } = await followed({
    [atlasPath]: appearanceOf(faint),
    [zephyrPath]: appearanceOf(faint),
  });
  expect(rootSet()).toStrictEqual({});
  routeParams = zephyr;
  act(redraw);
  await settled();
  expect(rootSet()).toStrictEqual({});
  expect(persistentStore.read(themeCacheKey)).toBeNull();
  expect(warned).toHaveBeenCalledTimes(1);
});
