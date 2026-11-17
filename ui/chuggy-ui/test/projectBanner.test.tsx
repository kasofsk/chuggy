/**
 * A project's banner over its tickets list: nothing drawn, and no image read,
 * where the project names none, its read of its images fails, the image's
 * read fails or the image cannot be drawn, or the reader hides banners; the
 * band drawn before the image's read answers and the image in it once it
 * does, saying nothing of itself; and the sheet's every value a token.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { ProjectBanner } from "../app/browser/ProjectBanner.tsx";
import {
  projectBannersStoreKey,
  projectBannersWrite,
} from "../app/browser/projectBanners.ts";
import { persistentStore } from "../app/browser/ports.ts";
import bannerSheet from "../app/browser/ProjectBanner.css?raw";
import tokenSheet from "../app/styles/tokens.css?raw";
import { answer, drawnStrict } from "./screenHarness.tsx";
import type { SentRequest } from "./screenHarness.tsx";
import { projectMarkPng, projectMarkRead } from "./projectMarkFixture.ts";

const atlas = { tenant: "acme", project: "atlas" };

const imagesPath = "/api/v1/tenants/acme/projects/atlas/appearance/images";

const bannerPath = "/api/v1/tenants/acme/projects/atlas/artifacts/banner-1";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function bannerAnswered(
  image: (request: SentRequest) => Response | Promise<Response>,
  images: unknown = { banner: "banner-1", administers: false },
): (request: SentRequest) => Response | Promise<Response> {
  return (request) => {
    if (request.url === imagesPath) return answer(images);
    if (request.url === bannerPath) return image(request);
    return answer({}, 404);
  };
}

function bandDrawn(): Element | null {
  return document.querySelector(".project-banner");
}

test("a project naming no banner draws nothing and reads no image", async () => {
  const drawn = await drawnStrict(
    <ProjectBanner partition={atlas} />,
    bannerAnswered(() => answer(projectMarkRead), { administers: false }),
  );
  expect(bandDrawn()).toBeNull();
  expect(drawn.sent.map((request) => request.url)).not.toContain(bannerPath);
});

test("the band is drawn before the image's read answers, and the image in it once it does, with empty alternative text", async () => {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await drawnStrict(
    <ProjectBanner partition={atlas} />,
    bannerAnswered(async () => {
      await released;
      return answer(projectMarkRead);
    }),
  );
  const band = bandDrawn();
  expect(band).not.toBeNull();
  expect(band?.querySelector("img")).toBeNull();
  release();
  await vi.waitFor(() => {
    expect(bandDrawn()?.querySelector("img")).not.toBeNull();
  });
  const image = bandDrawn()?.querySelector("img");
  expect(image?.getAttribute("src")).toBe(
    `data:image/png;base64,${projectMarkPng}`,
  );
  expect(image?.getAttribute("alt")).toBe("");
  expect(screen.queryByRole("img")).toBeNull();
  expect(bandDrawn()).toBe(band);
  expect(band?.textContent).toBe("");
});

test("a banner whose image's read fails is not drawn", async () => {
  await drawnStrict(
    <ProjectBanner partition={atlas} />,
    bannerAnswered(() => answer({ error: "NotFound" }, 404)),
  );
  expect(bandDrawn()).toBeNull();
});

test("a project whose read of its images fails draws nothing", async () => {
  await drawnStrict(<ProjectBanner partition={atlas} />, () =>
    answer({ error: "NotFound" }, 404),
  );
  expect(bandDrawn()).toBeNull();
});

test("a banner the browser cannot draw is taken away", async () => {
  await drawnStrict(
    <ProjectBanner partition={atlas} />,
    bannerAnswered(() => answer(projectMarkRead)),
  );
  const image = bandDrawn()?.querySelector("img");
  expect(image).not.toBeNull();
  if (image !== null && image !== undefined) fireEvent.error(image);
  expect(bandDrawn()).toBeNull();
});

test("a reader who hides banners is drawn none, and none is read", async () => {
  projectBannersWrite(persistentStore, "Hidden");
  expect(localStorage.getItem(projectBannersStoreKey)).toBe("Hidden");
  const drawn = await drawnStrict(
    <ProjectBanner partition={atlas} />,
    bannerAnswered(() => answer(projectMarkRead)),
  );
  expect(bandDrawn()).toBeNull();
  expect(drawn.sent).toStrictEqual([]);
});

test("every custom property the sheet reads is one the tokens name", () => {
  const named = new Set(
    [...tokenSheet.matchAll(/(--[a-z0-9-]+):/gu)].map((found) => found[1]),
  );
  const read = [...bannerSheet.matchAll(/var\((--[a-z0-9-]+)\)/gu)].map(
    (found) => found[1],
  );
  expect(read.length).toBeGreaterThan(0);
  expect(read.filter((property) => !named.has(property))).toStrictEqual([]);
  expect(named.has("--height-project-banner")).toBe(true);
});
