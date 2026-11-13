/**
 * The harness held to what it claims: served under the image's own headers,
 * and each helper failing on a page carrying the defect it names and passing
 * on one without it. The pages are written for the run, so no sheet of the
 * tree states the raw values they need.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  expect,
  renderedColoursSwept,
  renderedComputedStyle,
  renderedNoOverflow,
  renderedNoViolations,
  renderedOpen,
  renderedRootPropertiesSet,
  renderedTouchTargets,
  test,
} from "./driver.ts";
import type { Rendered } from "./driver.ts";
import { servedOpen } from "./served.ts";
import type { Served } from "./served.ts";
import { servedHeadersParse, servedHeadersRead } from "./servedHeaders.ts";

const sheet = `
:root { --height-touch: 44px; --ink: rgb(1, 2, 3); }
body { margin: 0; color: var(--ink); }
button { width: 48px; height: 48px; }
.wide { width: 600px; }
.small { width: 20px; height: 20px; }
`;

function page(body: string): string {
  return `<!doctype html><html><head><link rel="stylesheet" href="/page.css"></head><body>${body}</body></html>`;
}

const pages: Readonly<Record<string, string>> = {
  "index.html": page("<button>ok</button>"),
  "inline.html": page('<p style="color: red">inline</p><button>ok</button>'),
  "wide.html": page('<div class="wide">wide</div><button>ok</button>'),
  "small.html": page('<button class="small">s</button><button>ok</button>'),
  "scoped.html": page(
    '<section><button class="small">s</button></section><aside><button>ok</button></aside>',
  ),
};

let root = "";
let served: Served | undefined;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "chuggy-ui-harness-"));
  writeFileSync(join(root, "page.css"), sheet);
  for (const [name, markup] of Object.entries(pages))
    writeFileSync(join(root, name), markup);
  served = await servedOpen({ root });
});

test.afterAll(async () => {
  await served?.close();
  rmSync(root, { recursive: true, force: true });
});

async function harnessOpen(
  browser: Parameters<typeof renderedOpen>[0],
  route: string,
): Promise<Rendered> {
  if (served === undefined) throw new Error("the fixture site is not open");
  return renderedOpen(browser, served.origin, {
    route,
    viewport: "phone",
    signedIn: false,
    ready: (opened) => opened.getByRole("button", { name: "ok" }),
  });
}

test("a document is served with the policy nginx.conf states", async ({
  request,
}) => {
  const policy = new Map(servedHeadersRead().server).get(
    "content-security-policy",
  );
  expect(policy).toContain("default-src 'none'");
  const answered = await request.get(`${served?.origin ?? ""}/`);
  expect(answered.headers()["content-security-policy"]).toBe(policy);
  expect(answered.headers()["x-content-type-options"]).toBe("nosniff");
});

test("a location that declares headers sends only its own", () => {
  const parsed = servedHeadersParse(`
    http { server {
      add_header content-security-policy "default-src 'none'; img-src 'self'" always;
      add_header x-frame-options "DENY" always;
      location = /config.json { add_header cache-control "no-store" always; }
      location = /other { try_files $uri =404; }
    } }`);
  expect(parsed.server).toEqual([
    ["content-security-policy", "default-src 'none'; img-src 'self'"],
    ["x-frame-options", "DENY"],
  ]);
  expect(parsed.locations.get("/config.json")).toEqual([
    ["cache-control", "no-store"],
  ]);
  expect(parsed.locations.has("/other")).toBe(false);
});

test("a clean page passes every helper", async ({ browser }) => {
  const rendered = await harnessOpen(browser, "/");
  renderedNoViolations(rendered);
  await renderedNoOverflow(rendered.page);
  await renderedTouchTargets(rendered.page);
  expect(
    await renderedComputedStyle(rendered.page.locator("body"), "color"),
  ).toBe("rgb(1, 2, 3)");
});

test("an inline style is a violation the harness fails on", async ({
  browser,
}) => {
  const rendered = await harnessOpen(browser, "/inline.html");
  expect(() => {
    renderedNoViolations(rendered);
  }).toThrow(/content security policy refused/u);
  expect(rendered.violations[0]?.directive).toMatch(/^style-src/u);
});

test("a page wider than a phone fails the overflow helper", async ({
  browser,
}) => {
  const rendered = await harnessOpen(browser, "/wide.html");
  await expect(renderedNoOverflow(rendered.page)).rejects.toThrow(
    /scrolls sideways/u,
  );
});

test("a target smaller than the touch token fails", async ({ browser }) => {
  const rendered = await harnessOpen(browser, "/small.html");
  await expect(renderedTouchTargets(rendered.page)).rejects.toThrow(
    /smaller than 44px/u,
  );
});

test("a target smaller than the touch token fails only inside the scope it is held to", async ({
  browser,
}) => {
  const rendered = await harnessOpen(browser, "/scoped.html");
  await renderedTouchTargets(rendered.page, rendered.page.locator("aside"));
  await expect(
    renderedTouchTargets(rendered.page, rendered.page.locator("section")),
  ).rejects.toThrow(/smaller than 44px/u);
});

test("a custom property set on the root re-themes what the sweep reads", async ({
  browser,
}) => {
  const rendered = await harnessOpen(browser, "/");
  const bodyColour = (
    swept: Awaited<ReturnType<typeof renderedColoursSwept>>,
  ) =>
    swept.find((row) => row.element === "body[1]" && row.property === "color")
      ?.value;
  expect(bodyColour(await renderedColoursSwept(rendered.page))).toBe(
    "rgb(1, 2, 3)",
  );
  await renderedRootPropertiesSet(rendered.page, { "--ink": "rgb(4, 5, 6)" });
  expect(bodyColour(await renderedColoursSwept(rendered.page))).toBe(
    "rgb(4, 5, 6)",
  );
  renderedNoViolations(rendered);
});
