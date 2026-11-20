/**
 * A project's Appearance page: drawn to an administrator as three fields and
 * to anyone else as the view-only line; the default theme chosen and cleared,
 * kept as a copy, and offered back from the reader's own theme where that
 * has changed since; and an icon or a banner refused before anything is sent
 * where its type or its size is not one its role takes, refused in the same
 * words where the server refuses it, and otherwise uploaded, named, previewed
 * and cleared, each write confirmed in the shell's toast.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { builtInThemes } from "../../../../src/contract/appearance.ts";
import type { ThemeDocument } from "../../../../src/contract/appearance.ts";
import { projectIconBytesMax } from "../../../../src/contract/http.ts";
import { ConsoleWriteToasts } from "../../app/browser/consoleWrite.tsx";
import { AppearanceSettingsPage } from "../../app/browser/settings/AppearanceSettingsPage.tsx";
import { renderCopied } from "../copied.tsx";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "../screenHarness.tsx";
import { toastsDrawn } from "../toastsDrawn.ts";
import type * as BrowserPorts from "../../app/browser/ports.ts";

const partition = vi.hoisted(() => ({ tenant: "acme", project: "atlas" }));

vi.mock("../../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...partition }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const projectPath = `/api/v1/tenants/${partition.tenant}/projects/${partition.project}`;
const themePath = `${projectPath}/appearance/theme`;
const imagesPath = `${projectPath}/appearance/images`;
const uploadPath = `${projectPath}/artifacts`;

const mine: ThemeDocument = { ...builtInThemes.ember, name: "Mine" };

/** A request the page sent: a JSON body parsed, bytes as they were sent. */
interface Sent {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

interface Drawing {
  readonly administer?: boolean;
  /** The project's default theme as the server keeps it. */
  readonly theme?: ThemeDocument;
  readonly owned?: readonly ThemeDocument[];
  /** What naming an image answers, where it refuses. */
  readonly namingRefused?: Response;
}

/** A server that keeps what it is sent. */
function appearanceServer(drawing: Drawing): (request: Sent) => Response {
  let theme = drawing.theme;
  const images: { icon?: string; banner?: string } = {};
  return (request: Sent): Response => {
    const { method, url } = request;
    if (url === `${projectPath}/abilities`)
      return answer({
        principal: "issuer reader",
        mutate: true,
        dispatch: true,
        manageSelector: false,
        overrideTicketConfig: false,
        skipPlannedEvaluations: false,
        mergeProposals: false,
        makeAccessTokens: false,
        administer: drawing.administer ?? true,
        writeEpic: true,
      });
    if (url === "/api/v1/projects")
      return answer({ projects: [{ ...partition, name: "Atlas Web" }] });
    if (url === "/api/v1/appearance/themes")
      return answer({
        themes: (drawing.owned ?? []).map((document, at) => ({
          theme: at + 1,
          document,
        })),
      });
    if (url === themePath) {
      if (method === "PUT")
        theme = (request.body as { document?: ThemeDocument }).document;
      return answer({
        ...(theme === undefined ? {} : { document: theme }),
        administers: true,
      });
    }
    if (method === "POST" && url === uploadPath)
      return answer({ artifact: "artifact-new", digest: "d" }, 201);
    if (url.startsWith(`${imagesPath}/`)) {
      if (drawing.namingRefused !== undefined && method === "PUT")
        return drawing.namingRefused;
      const role = url.slice(imagesPath.length + 1) as "icon" | "banner";
      if (method === "PUT")
        images[role] = (request.body as { artifact: string }).artifact;
      else delete images[role];
    }
    if (url.startsWith(imagesPath))
      return answer({ ...images, administers: true });
    if (url.includes("/artifacts/"))
      return answer({
        mediaType: "image/png",
        content: "AQID",
        encoding: "base64",
      });
    return answer({ error: { code: "NotFound" } }, 404);
  };
}

/** The page under `appearanceServer`. */
async function drawPage(drawing: Drawing = {}): Promise<readonly Sent[]> {
  const sent: Sent[] = [];
  const answered = appearanceServer(drawing);
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const body = init?.body;
    const request: Sent = {
      method: init?.method ?? "GET",
      url,
      body: typeof body === "string" ? JSON.parse(body) : body,
    };
    sent.push(request);
    return Promise.resolve(answered(request));
  });
  renderCopied(
    <ScreenHarness
      partition={partition}
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
      transport={openedStream().ports.fetch}
    >
      <AppearanceSettingsPage />
      <ConsoleWriteToasts />
    </ScreenHarness>,
  );
  await settled();
  return sent;
}

function writes(sent: readonly Sent[]): readonly (readonly [string, string])[] {
  return sent
    .filter((one) => one.method !== "GET")
    .map((one) => [one.method, one.url.slice(projectPath.length)]);
}

function picker(): HTMLElement {
  return screen.getByRole("radiogroup", { name: "Default theme" });
}

function checked(): string | null {
  return within(picker()).getByRole("radio", { checked: true }).textContent;
}

async function choose(name: string): Promise<void> {
  await turned(() => {
    fireEvent.click(within(picker()).getByRole("radio", { name }));
  });
  await settled();
}

function field(name: string): HTMLElement {
  return screen.getByRole("group", { name });
}

async function picked(role: string, file: File): Promise<void> {
  const input = field(role).querySelector("input[type=file]");
  if (input === null) throw new Error(`the ${role} field holds no picker`);
  await turned(() => {
    fireEvent.change(input, { target: { files: [file] } });
  });
  await settled();
}

async function pressed(name: string): Promise<void> {
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
  await settled();
}

function png(bytesCount: number): File {
  return new File([new Uint8Array(bytesCount)], "mark.png", {
    type: "image/png",
  });
}

test("an administrator is drawn the default theme, the icon and the banner, each with its hint, and no image yet as its placeholder", async () => {
  await drawPage();
  expect(checked()).toBe("None");
  expect(
    within(picker())
      .getAllByRole("radio")
      .map((radio) => radio.textContent),
  ).toStrictEqual(["None", "Chuggy", "Harbour", "Ember", "High contrast"]);
  expect(picker().getAttribute("aria-describedby")).not.toBeNull();
  expect(
    document.getElementById(picker().getAttribute("aria-describedby") ?? "")
      ?.textContent,
  ).toBe(
    "This project keeps its own copy of the theme chosen, so later edits to your theme do not change it. Each person can still choose their own theme for this project.",
  );
  expect(within(field("Icon")).getByText("No icon")).toBeDefined();
  expect(within(field("Banner")).getByText("No banner")).toBeDefined();
  expect(
    screen.getByText(
      "PNG, JPEG, WEBP, up to 256 KiB. A square image suits it best.",
    ),
  ).toBeDefined();
  expect(
    screen.getByText(
      "PNG, JPEG, WEBP, up to 2 MiB. A wide image suits it best.",
    ),
  ).toBeDefined();
  expect(
    screen.getByRole("button", { name: "Choose an icon file" }),
  ).toBeDefined();
  expect(screen.queryByRole("button", { name: "Clear the icon" })).toBeNull();
});

test("a reader who does not administer the project is drawn the view-only line and none of the fields", async () => {
  await drawPage({ administer: false });
  expect(screen.queryByRole("radiogroup")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByText("View only")).toBeDefined();
});

test("a theme chosen is written whole onto the project and confirmed, and None clears it", async () => {
  const sent = await drawPage();
  await choose("Harbour");
  expect(checked()).toBe("Harbour");
  const put = sent.filter((one) => one.method === "PUT").at(-1);
  expect(put?.body).toStrictEqual({ document: builtInThemes.harbour });
  expect(toastsDrawn()).toStrictEqual([
    { tone: "Success", line: "Default theme saved" },
  ]);
  await choose("None");
  expect(checked()).toBe("None");
  expect(sent.filter((one) => one.method === "PUT").at(-1)?.body).toStrictEqual(
    {},
  );
  expect(toastsDrawn()).toStrictEqual([
    { tone: "Success", line: "Default theme cleared" },
  ]);
});

test("where the project keeps a copy of the reader's theme that has since changed, the copy is marked and updating from the theme is offered and writes it", async () => {
  const kept: ThemeDocument = { ...mine, textSize: "Large" };
  const sent = await drawPage({ theme: kept, owned: [mine] });
  expect(checked()).toBe("Mine, as this project keeps it");
  expect(
    screen.getByText("Your theme Mine has changed since this project kept it."),
  ).toBeDefined();
  await pressed("Update from my theme");
  expect(sent.filter((one) => one.method === "PUT").at(-1)?.body).toStrictEqual(
    { document: mine },
  );
  expect(checked()).toBe("Mine");
  expect(
    screen.queryByRole("button", { name: "Update from my theme" }),
  ).toBeNull();
  expect(
    within(picker()).queryByRole("radio", {
      name: "Mine, as this project keeps it",
    }),
  ).toBeNull();
});

test("where the project keeps the reader's theme as it stands, that theme is marked and nothing is offered", async () => {
  await drawPage({ theme: { ...mine }, owned: [mine] });
  expect(checked()).toBe("Mine");
  expect(
    screen.queryByRole("button", { name: "Update from my theme" }),
  ).toBeNull();
});

test("a file of a type neither role takes is refused in plain words before anything is sent", async () => {
  const sent = await drawPage();
  await picked(
    "Icon",
    new File([new Uint8Array(3)], "mark.gif", { type: "image/gif" }),
  );
  expect(
    within(field("Icon").parentElement ?? document.body).getByText(
      "Not saved: only PNG, JPEG, WEBP can be used.",
    ),
  ).toBeDefined();
  expect(writes(sent)).toStrictEqual([]);
});

test("a file past its role's bound is refused in plain words before anything is sent", async () => {
  const sent = await drawPage();
  await picked("Icon", png(projectIconBytesMax + 1));
  expect(
    screen.getByText("Not saved: the file is larger than 256 KiB."),
  ).toBeDefined();
  expect(writes(sent)).toStrictEqual([]);
});

test("the server's refusal of an image is said in the words the page refuses one in", async () => {
  const sent = await drawPage({
    namingRefused: answer(
      { error: { code: "ImageTooLarge", message: "too large" }, bytesMax: 1 },
      422,
    ),
  });
  await picked("Icon", png(3));
  expect(writes(sent)).toStrictEqual([
    ["POST", "/artifacts"],
    ["PUT", "/appearance/images/icon"],
  ]);
  expect(
    screen.getByText("Not saved: the file is larger than 256 KiB."),
  ).toBeDefined();
  expect(toastsDrawn()).toStrictEqual([]);
  expect(within(field("Icon")).getByText("No icon")).toBeDefined();
});

test("an icon chosen is uploaded as the bytes picked, named, previewed under the project's name at each size on light and dark, and cleared", async () => {
  const sent = await drawPage();
  await picked("Icon", png(3));
  const upload = sent.find((one) => one.method === "POST");
  expect(upload?.body).toStrictEqual(new Uint8Array(3));
  expect(
    sent.filter((one) => one.method === "PUT").map((one) => one.body),
  ).toStrictEqual([{ artifact: "artifact-new" }]);
  expect(toastsDrawn()).toStrictEqual([
    { tone: "Success", line: "Icon saved" },
  ]);
  const preview = screen.getByRole("group", {
    name: "The icon as it is drawn",
  });
  expect(
    within(preview)
      .getAllByRole("img")
      .map((image) => image.getAttribute("alt")),
  ).toStrictEqual(["Atlas Web", "Atlas Web", "Atlas Web", "Atlas Web"]);
  expect(
    [...preview.querySelectorAll("[data-scheme]")].map((surface) =>
      surface.getAttribute("data-scheme"),
    ),
  ).toStrictEqual(["light", "dark"]);
  await pressed("Clear the icon");
  expect(writes(sent).at(-1)).toStrictEqual([
    "DELETE",
    "/appearance/images/icon",
  ]);
  expect(within(field("Icon")).getByText("No icon")).toBeDefined();
  expect(toastsDrawn()).toStrictEqual([
    { tone: "Success", line: "Icon cleared" },
  ]);
});

test("a banner is previewed as decoration, at a phone's width and a desk's", async () => {
  await drawPage();
  await picked(
    "Banner",
    new File([new Uint8Array(3)], "band.webp", { type: "image/webp" }),
  );
  const preview = screen.getByRole("group", {
    name: "The banner above the tickets",
  });
  expect(within(preview).queryAllByRole("img")).toStrictEqual([]);
  const bands = preview.querySelectorAll("img");
  expect([...bands].map((band) => band.getAttribute("alt"))).toStrictEqual([
    "",
    "",
  ]);
  expect(preview.textContent).toBe("PhoneDesktop");
  expect(toastsDrawn()).toStrictEqual([
    { tone: "Success", line: "Banner saved" },
  ]);
});
