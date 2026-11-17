/**
 * A project's mark alone: its initial and tint, both read from the name; the
 * tints `tokens.css` names and the sheet draws, one for each the core picks
 * from; the icon in a box drawn at its size before its read answers, read once
 * however many marks draw it; the fallback where the read fails or the image
 * cannot be drawn; and what the mark says, nothing beside a drawn name and the
 * project's name alone. The workspace's grid of projects draws each name after
 * its mark, from the inventory.
 */

import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { ProjectMark } from "../app/browser/ProjectMark.tsx";
import { TenantProjectsGrid } from "../app/browser/settings/TenantProjectsGrid.tsx";
import {
  projectMarkInitial,
  projectMarkTint,
  projectMarkTints,
} from "../app/core/projectMark.ts";
import markSheet from "../app/browser/ProjectMark.css?raw";
import tokenSheet from "../app/styles/tokens.css?raw";
import { answer, drawnStrict, heldAnswer } from "./screenHarness.tsx";
import type { SentRequest } from "./screenHarness.tsx";
import { projectMarkPng, projectMarkRead } from "./projectMarkFixture.ts";

const atlas = { tenant: "acme", project: "atlas" };

const iconPath = "/api/v1/tenants/acme/projects/atlas/artifacts/icon-1";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function iconAsked(sent: readonly SentRequest[]): number {
  return sent.filter((request) => request.url === iconPath).length;
}

test("the initial is the name's first letter or digit, upper-cased", () => {
  expect(projectMarkInitial("atlas")).toBe("A");
  expect(projectMarkInitial("  émile")).toBe("É");
  expect(projectMarkInitial("#42 ops")).toBe("4");
  expect(projectMarkInitial("—")).toBe("—");
  expect(projectMarkInitial("")).toBe("");
});

test("a name is drawn on the same tint every time, one of those the tokens name", () => {
  const names = Array.from({ length: 64 }, (_, at) => `project-${String(at)}`);
  const tints = new Set(names.map(projectMarkTint));
  expect(names.map(projectMarkTint)).toStrictEqual(names.map(projectMarkTint));
  expect([...tints].sort()).toStrictEqual(
    Array.from({ length: projectMarkTints }, (_, at) => at + 1),
  );
});

test("the tokens name a tint for each the core picks, and the sheet draws each", () => {
  const named = [...tokenSheet.matchAll(/--mark-tint-([0-9]+):/gu)].map(
    (found) => Number(found[1]),
  );
  const drawn = [...markSheet.matchAll(/data-tint="([0-9]+)"/gu)].map((found) =>
    Number(found[1]),
  );
  const tints = Array.from({ length: projectMarkTints }, (_, at) => at + 1);
  expect(named).toStrictEqual(tints);
  expect(drawn).toStrictEqual(tints);
});

test("a project with no icon is its initial on its tint, saying nothing beside its name", async () => {
  const drawn = await drawnStrict(
    <ProjectMark partition={atlas} name="Atlas" icon={undefined} size="sm" />,
    () => answer({}),
  );
  const mark = document.querySelector(".project-mark");
  expect(mark?.textContent).toBe("A");
  expect(mark?.getAttribute("data-tint")).toBe(
    String(projectMarkTint("Atlas")),
  );
  expect(mark?.getAttribute("aria-hidden")).toBe("true");
  expect(mark?.classList.contains("project-mark-sm")).toBe(true);
  expect(drawn.sent).toStrictEqual([]);
});

test("a mark standing for the name is named by it", async () => {
  await drawnStrict(
    <ProjectMark
      partition={atlas}
      name="Atlas"
      icon={undefined}
      size="md"
      alone
    />,
    () => answer({}),
  );
  expect(screen.getByRole("img", { name: "Atlas" }).textContent).toBe("A");
});

test("an icon's box is drawn at its size before its read answers, and the icon in it once it does", async () => {
  const held = heldAnswer();
  await drawnStrict(
    <ProjectMark partition={atlas} name="Atlas" icon="icon-1" size="md" />,
    (request) => (request.url === iconPath ? held.answered : answer({}, 404)),
  );
  const box = document.querySelector(".project-mark");
  expect(box?.classList.contains("project-mark-md")).toBe(true);
  expect(box?.querySelector("img")).toBeNull();
  expect(box?.textContent).toBe("");
  held.release(answer(projectMarkRead));
  await vi.waitFor(() => {
    expect(document.querySelector(".project-mark img")).not.toBeNull();
  });
  const image = document.querySelector(".project-mark img");
  expect(image?.getAttribute("src")).toBe(
    `data:image/png;base64,${projectMarkPng}`,
  );
  expect(image?.getAttribute("alt")).toBe("");
  expect(document.querySelector(".project-mark")).toBe(box);
});

test("an icon standing for the name is named by it, and is read once however many marks draw it", async () => {
  const drawn = await drawnStrict(
    <>
      <ProjectMark partition={atlas} name="Atlas" icon="icon-1" size="sm" />
      <ProjectMark
        partition={atlas}
        name="Atlas"
        icon="icon-1"
        size="md"
        alone
      />
    </>,
    (request) =>
      request.url === iconPath ? answer(projectMarkRead) : answer({}, 404),
  );
  expect(screen.getByRole("img", { name: "Atlas" }).tagName).toBe("IMG");
  expect(iconAsked(drawn.sent)).toBe(1);
});

test("an icon whose read fails is drawn as the initial", async () => {
  await drawnStrict(
    <ProjectMark partition={atlas} name="Atlas" icon="icon-1" size="sm" />,
    () => answer({ error: "NotFound" }, 404),
  );
  const mark = document.querySelector(".project-mark");
  expect(mark?.querySelector("img")).toBeNull();
  expect(mark?.textContent).toBe("A");
});

test("an icon the browser cannot draw is drawn as the initial", async () => {
  await drawnStrict(
    <ProjectMark
      partition={atlas}
      name="Atlas"
      icon="icon-1"
      size="sm"
      alone
    />,
    () => answer(projectMarkRead),
  );
  fireEvent.error(screen.getByRole("img", { name: "Atlas" }));
  const mark = screen.getByRole("img", { name: "Atlas" });
  expect(mark.tagName).toBe("SPAN");
  expect(mark.textContent).toBe("A");
});

test("the workspace's grid draws each project's name after its mark, which says nothing", async () => {
  await drawnStrict(
    <TenantProjectsGrid
      tenant="acme"
      projects={["atlas", "hermes"]}
      box={() => ({ checked: false, disabled: false })}
      onToggle={() => undefined}
    />,
    (request) => {
      if (request.url === iconPath) return answer(projectMarkRead);
      return answer({
        projects: [
          { ...atlas, name: "Atlas", icon: "icon-1" },
          { tenant: "acme", project: "hermes", name: "Hermes" },
        ],
      });
    },
  );
  const grid = screen.getByRole("table", { name: "Projects" });
  const [atlasRow, hermesRow] = within(grid).getAllByRole("rowheader");
  expect(
    atlasRow?.querySelector(".project-mark img")?.getAttribute("alt"),
  ).toBe("");
  expect(within(grid).getByRole("rowheader", { name: "Atlas" })).toBe(atlasRow);
  expect(
    hermesRow?.querySelector('.project-mark[aria-hidden="true"]')?.textContent,
  ).toBe("H");
  expect(within(grid).getByRole("rowheader", { name: "Hermes" })).toBe(
    hermesRow,
  );
});
