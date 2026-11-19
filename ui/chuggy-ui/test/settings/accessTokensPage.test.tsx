/**
 * The Access tokens settings page, mounted: New token hidden only where the
 * abilities read answers no, a mint whose secret is shown once and held by
 * nothing once its dialog is put away or its page left, each refusal's line,
 * each token's standing drawn on the page's own clock, deletion through a
 * Confirm, and Maker only in an administrator's list.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import {
  accessTokenLimitReachedCode,
  accessTokenMintForbiddenCode,
  accessTokenNameTakenCode,
  accessTokenWarningDays,
} from "../../../../src/contract/accessToken.ts";
import type {
  AccessTokenMintedResponse,
  AccessTokenResponse,
} from "../../../../src/contract/accessToken.ts";
import type { ProjectAbilitiesResponse } from "../../../../src/contract/responses.ts";
import { AccessTokensPage } from "../../app/browser/settings/AccessTokensPage.tsx";
import { CopyProvider } from "../../app/browser/ui/copyHeld.tsx";
import type { CopyWrite } from "../../app/browser/ui/copyHeld.tsx";
import { abilitiesEvery, abilitiesNone } from "../projectAbilitiesFixture.ts";
import { projectPartition } from "../projectFixture.ts";
import { resizeObserverStubbed } from "../resizeObserver.ts";
import {
  answer,
  drawnStrict,
  press,
  sectionOf,
  settled,
  turned,
} from "../screenHarness.tsx";
import type { DrawnStrict, SentRequest } from "../screenHarness.tsx";
import type * as BrowserPorts from "../../app/browser/ports.ts";
import { tokenHeldOutside } from "./inviteDialogDrawn.ts";

const clock = { nowMs: Date.parse("2026-11-19T12:00:00Z") };

vi.mock("../../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
  nowMs: () => clock.nowMs,
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...projectPartition }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(() => {
  resizeObserverStubbed();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const dayMs = 24 * 60 * 60 * 1000;

const reader: ProjectAbilitiesResponse = {
  ...abilitiesNone,
  makeAccessTokens: true,
};

function token(
  name: string,
  expiresMs: number,
  extra: Partial<AccessTokenResponse> = {},
): AccessTokenResponse {
  return {
    token: `t-${name}`,
    name,
    access: "Read",
    maker: abilitiesEvery.principal,
    createdAt: "2026-10-01T00:00:00Z",
    expiresAt: new Date(expiresMs).toISOString(),
    ...extra,
  };
}

/** One token a standing, each at the edge of the one before it on the page's
 * clock: past the warning days by an instant, at their first instant, and at
 * expiry. */
function tokensAtEdges(): readonly AccessTokenResponse[] {
  const warnedMs = accessTokenWarningDays * dayMs;
  return [
    token("lasting", clock.nowMs + warnedMs + 1, { access: "Write" }),
    token("nearing", clock.nowMs + warnedMs),
    token("ended", clock.nowMs),
  ];
}

const minted: AccessTokenMintedResponse = {
  ...token("deploy", Date.parse("2026-12-19T12:00:00Z")),
  secret: `chgp_${"s".repeat(43)}`,
};

interface TokensDrawing {
  readonly abilities?: ProjectAbilitiesResponse | "Failed";
  readonly tokens?: () => readonly AccessTokenResponse[];
  readonly mint?: (request: SentRequest) => Response | Promise<Response>;
  readonly deletion?: (request: SentRequest) => Response;
  readonly copied?: CopyWrite;
}

const tokensPath = "/access-tokens";

async function drawTokens(drawing: TokensDrawing = {}): Promise<DrawnStrict> {
  const page = (
    <CopyProvider write={drawing.copied ?? (() => Promise.resolve(true))}>
      <AccessTokensPage />
    </CopyProvider>
  );
  return drawnStrict(page, (request) => {
    if (request.url.endsWith("/abilities"))
      return drawing.abilities === "Failed"
        ? answer({}, 500)
        : answer(drawing.abilities ?? reader);
    if (request.url.endsWith(tokensPath)) {
      if (request.method === "POST")
        return (drawing.mint ?? (() => answer(minted, 201)))(request);
      return answer({ tokens: drawing.tokens?.() ?? [] });
    }
    if (request.url.includes(`${tokensPath}/`))
      return (drawing.deletion ?? (() => new Response(null, { status: 204 })))(
        request,
      );
    return answer({}, 404);
  });
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog", { name: "New token" });
}

/** The dialog opened and a name typed into it. */
async function named(name = "deploy"): Promise<void> {
  await press("New token");
  await turned(() => {
    fireEvent.change(within(dialog()).getByRole("textbox", { name: "Name" }), {
      target: { value: name },
    });
  });
}

/** The dialog's link to the docs page on using a token, opening apart. */
function expectHowToUse(region: HTMLElement): void {
  const link = within(region).getByRole("link", { name: "How to use" });
  expect(link.getAttribute("href")).toBe(
    "https://github.com/kasofsk/chuggy-docs/blob/main/docs/access-tokens.md",
  );
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
}

function rowsText(): readonly string[] {
  return within(sectionOf("Access tokens"))
    .getAllByRole("row")
    .map((row) => row.textContent);
}

function headings(): readonly (string | null)[] {
  return within(sectionOf("Access tokens"))
    .getAllByRole("columnheader")
    .map((header) => header.textContent);
}

/** Every answer the cache's writes still hold, as one string to search. */
function writesHeld(drawn: DrawnStrict): string {
  return JSON.stringify(
    drawn.client
      .getMutationCache()
      .getAll()
      .map((one) => one.state.data),
  );
}

test("New token is hidden only where the abilities say no, and an empty list says No tokens", async () => {
  await drawTokens({ abilities: abilitiesNone });
  const section = sectionOf("Access tokens");
  expect(within(section).getByText("No tokens")).toBeTruthy();
  expect(within(section).queryByRole("table")).toBeNull();
  expect(screen.queryByRole("button", { name: "New token" })).toBeNull();
  cleanup();
  await drawTokens({ abilities: reader });
  expect(screen.getByRole("button", { name: "New token" })).toBeTruthy();
  expect(
    within(sectionOf("Access tokens")).getByText("No tokens"),
  ).toBeTruthy();
  cleanup();
  await drawTokens({ abilities: "Failed" });
  expect(screen.getByRole("button", { name: "New token" })).toBeTruthy();
});

test("the dialog opens on Read for thirty days, says the token is the reader's own, and sends what was chosen", async () => {
  const drawn = await drawTokens();
  await named(" deploy ");
  const opened = dialog();
  expect(
    within(opened)
      .getByRole("radio", { name: "Read" })
      .getAttribute("aria-checked"),
  ).toBe("true");
  expect(
    within(opened).getByRole("button", { name: /^Expires/u }).textContent,
  ).toContain("30 days");
  expect(
    within(opened).getByText("For your own scripts. Never share it."),
  ).toBeTruthy();
  expectHowToUse(opened);
  await turned(() => {
    fireEvent.click(within(opened).getByRole("radio", { name: "Write" }));
  });
  await turned(() => {
    fireEvent.keyDown(
      within(opened).getByRole("button", { name: /^Expires/u }),
      { key: "ArrowDown" },
    );
  });
  const menu = await screen.findByRole("menu");
  expect(
    within(menu)
      .getAllByRole("menuitemradio")
      .map((item) => item.textContent),
  ).toStrictEqual(["7 days", "30 days", "60 days", "90 days", "1 year"]);
  await turned(() => {
    within(menu).getByRole("menuitemradio", { name: "1 year" }).click();
  });
  await press("Create token");
  expect(
    drawn.sent
      .filter((sent) => sent.method === "POST")
      .map((sent) => sent.body),
  ).toStrictEqual([{ name: "deploy", access: "Write", lifetimeDays: 365 }]);
});

test("a token made shows its secret once beside Copy, and once put away nothing holds it", async () => {
  const copied = vi.fn<CopyWrite>(() => Promise.resolve(true));
  const drawn = await drawTokens({ copied });
  await named();
  await press("Create token");
  const field = within(dialog()).getByRole<HTMLInputElement>("textbox", {
    name: "Token",
  });
  expect(field.value).toBe(minted.secret);
  expect(field.readOnly).toBe(true);
  await turned(() => {
    fireEvent.click(
      within(dialog()).getByRole("button", { name: "Copy token" }),
    );
  });
  expect(copied).toHaveBeenCalledWith(minted.secret);
  expect(
    within(dialog()).getByText("Copy it now. It is not shown again."),
  ).toBeTruthy();
  expect(
    within(dialog()).getByText(
      "Use it as CHUGGY_TOKEN for chuggy-linux mcp or chuggy-darwin mcp.",
    ),
  ).toBeTruthy();
  expectHowToUse(dialog());
  await press("Done");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(tokenHeldOutside(minted.secret, [])).toStrictEqual([]);
  expect(writesHeld(drawn)).not.toContain(minted.secret);
  await press("New token");
  expect(
    within(dialog()).getByRole<HTMLInputElement>("textbox", { name: "Name" })
      .value,
  ).toBe("");
  expect(dialog().textContent).not.toContain(minted.secret);
});

test("a page left with the secret shown holds it nowhere", async () => {
  const drawn = await drawTokens();
  await named();
  await press("Create token");
  expect(writesHeld(drawn)).toContain(minted.secret);
  cleanup();
  expect(writesHeld(drawn)).not.toContain(minted.secret);
});

test("a mint that lands after its page was left is held nowhere", async () => {
  let landed: (response: Response) => void = () => undefined;
  const drawn = await drawTokens({
    mint: () =>
      new Promise<Response>((resolve) => {
        landed = resolve;
      }),
  });
  await named();
  await press("Create token");
  expect(
    drawn.client
      .getMutationCache()
      .getAll()
      .map((one) => one.state.status),
  ).toStrictEqual(["pending"]);
  cleanup();
  landed(answer(minted, 201));
  await settled();
  expect(writesHeld(drawn)).not.toContain(minted.secret);
});

test("each of the mint's refusals is one line in the dialog, read by its code, with what was typed kept", async () => {
  const refusals: readonly (readonly [number, string, string])[] = [
    [409, accessTokenLimitReachedCode, "Token limit reached"],
    [409, accessTokenNameTakenCode, "Name already in use"],
    [403, accessTokenMintForbiddenCode, "Not permitted to make tokens"],
  ];
  for (const [status, code, line] of refusals) {
    await drawTokens({
      mint: () => answer({ error: { code, message: code } }, status),
    });
    await named();
    await press("Create token");
    expect(within(dialog()).getByText(line)).toBeTruthy();
    expect(
      within(dialog()).getByRole<HTMLInputElement>("textbox", { name: "Name" })
        .value,
    ).toBe("deploy");
    cleanup();
  }
});

test("each token's standing is drawn on the page's clock: Active past the warning days, Expiring with its days left at their edge, and Expired at expiry", async () => {
  await drawTokens({ tokens: tokensAtEdges });
  const [, lasting, nearing, ended] = rowsText();
  expect(lasting).toMatch(/^lasting.*Write.*Active/u);
  expect(lasting).not.toMatch(/left/u);
  expect(nearing).toMatch(
    new RegExp(
      `^nearing.*Read.*${String(accessTokenWarningDays)} days leftExpiring`,
      "u",
    ),
  );
  expect(ended).toMatch(/^ended.*Read.*Expired/u);
  expect(ended).not.toMatch(/left/u);
});

test("Maker is a column only in an administrator's list", async () => {
  const columns = ["Name", "Access", "Created", "Expires", "Status"];
  await drawTokens({ tokens: tokensAtEdges });
  expect(headings()).toStrictEqual([...columns, "Delete"]);
  cleanup();
  await drawTokens({ abilities: abilitiesEvery, tokens: tokensAtEdges });
  expect(headings()).toStrictEqual([...columns, "Made by", "Delete"]);
});

test("Delete asks first, says anything using the token stops, and sends nothing until it is confirmed", async () => {
  let listed = tokensAtEdges();
  const drawn = await drawTokens({
    tokens: () => listed,
    deletion: (request) => {
      listed = listed.filter((one) => !request.url.endsWith(`/${one.token}`));
      return new Response(null, { status: 204 });
    },
  });
  const deletions = () =>
    drawn.sent
      .filter((sent) => sent.method === "DELETE")
      .map((sent) => sent.url);
  const row = within(sectionOf("Access tokens")).getAllByRole("row")[2];
  if (row === undefined) throw new Error("no row for the nearing token");
  await turned(() => {
    fireEvent.click(within(row).getByRole("button", { name: "Delete" }));
  });
  await settled();
  const asked = screen.getByRole("group", { name: "Delete nearing?" });
  expect(asked.textContent).toContain(
    "Anything using this token stops at once.",
  );
  expect(deletions()).toStrictEqual([]);
  await turned(() => {
    fireEvent.click(within(asked).getByRole("button", { name: "Cancel" }));
  });
  expect(screen.queryByRole("group", { name: "Delete nearing?" })).toBeNull();
  expect(deletions()).toStrictEqual([]);
  await turned(() => {
    fireEvent.click(within(row).getByRole("button", { name: "Delete" }));
  });
  await turned(() => {
    fireEvent.click(
      within(screen.getByRole("group", { name: "Delete nearing?" })).getByRole(
        "button",
        { name: "Delete" },
      ),
    );
  });
  await settled();
  expect(deletions()).toHaveLength(1);
  expect(deletions()[0]).toMatch(/\/access-tokens\/t-nearing$/u);
  expect(rowsText().some((text) => text.startsWith("nearing"))).toBe(false);
});
