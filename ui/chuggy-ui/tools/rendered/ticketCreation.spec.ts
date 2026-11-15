/**
 * The new-ticket form on a phone, pressed by a finger: its first screen, and
 * then its disclosure open with every group it holds. In each, nothing scrolls
 * the page sideways, every control the form draws is at least the touch
 * height, and every box a reader types into is drawn at `--text-unzoomed` or
 * larger, the size a phone types in without zooming; focusing each leaves the
 * page at its own scale. The shell around the form is not the form's, so both
 * heights are held under the form alone. Every read is one the stub answers,
 * the project's ready configuration among them, whose repository's name runs
 * past a phone, and one Active epic, so the epic is asked.
 */

import { epicListResponseSchema } from "../../../../src/contract/responses.ts";
import { phaseRoster } from "../../../../src/contract/rosters.ts";

import {
  expect,
  renderedDist,
  renderedNoOverflow,
  renderedNoViolations,
  renderedOpen,
  renderedTokenPixels,
  renderedTouchTargets,
  test,
} from "./driver.ts";
import type { Browser, Locator, Page } from "@playwright/test";

import { servedOpen } from "./served.ts";
import type { Served } from "./served.ts";
import { stubApiProject, stubApiRead, stubApiTenant } from "./stubApi.ts";

const zodProbeViolation = { directive: "script-src", blocked: "eval" };

const creationPath = `/${stubApiTenant}/${stubApiProject}/tickets/new`;

/** The project's one Active epic, as the roster the form's picker reads. */
const creationEpics = stubApiRead(
  `/api/v1/tenants/${stubApiTenant}/projects/${stubApiProject}/epics`,
  epicListResponseSchema,
  {
    epics: [
      {
        number: 1,
        revision: 1,
        title: "The rendered epic",
        visibility: "Active",
        progress: {
          byPhase: Object.fromEntries(phaseRoster.map((phase) => [phase, 0])),
          drafts: 0,
          done: 0,
          total: 0,
        },
        status: "empty",
        waitingOnOutside: [],
      },
    ],
  },
);

/** Every box the form draws that a reader types into. */
function creationTyped(form: Locator): Locator {
  return form.locator("input:not([type=file]), textarea");
}

/** Each typed box is drawn at no less than the unzoomed size, and focusing it
 * leaves the page at its own scale and no wider than the screen. */
async function creationUnzoomed(page: Page, form: Locator): Promise<void> {
  const least = await renderedTokenPixels(page, "--text-unzoomed");
  expect(least, "the root states no --text-unzoomed").toBeGreaterThan(0);
  const boxes = await creationTyped(form).all();
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    const pixels = await box.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
    expect(pixels, await box.evaluate((element) => element.outerHTML)).toBe(
      Math.max(pixels, least),
    );
    await box.focus();
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(
      1,
    );
    await renderedNoOverflow(page);
  }
}

test("the new-ticket form fits a phone, each control a finger's height, and focusing a box zooms nothing, closed and open", async ({
  browser,
}) => {
  const served = await servedOpen({
    root: renderedDist,
    reads: [creationEpics],
  });
  try {
    await creationOnPhone(browser, served);
  } finally {
    await served.close();
  }
});

async function creationOnPhone(
  browser: Browser,
  served: Served,
): Promise<void> {
  const rendered = await renderedOpen(browser, served.origin, {
    route: creationPath,
    viewport: "phone",
    signedIn: true,
    touch: true,
    ready: (page) => page.getByRole("textbox", { name: "Intent" }),
  });
  const page = rendered.page;
  const form = page.locator(".creation");
  const more = page.getByRole("button", { name: /^More options/u });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await renderedNoOverflow(page);
  await renderedTouchTargets(page, form);
  await creationUnzoomed(page, form);

  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("textbox", { name: "Title" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Check 1" })).toHaveCount(0);
  await page.getByRole("button", { name: "Add check" }).click();
  await page.getByRole("button", { name: "Add link" }).click();
  await expect(page.getByRole("checkbox", { name: "Ticket 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Epic/u })).toBeVisible();
  await renderedNoOverflow(page);
  await renderedTouchTargets(page, form);
  await creationUnzoomed(page, form);
  renderedNoViolations(rendered, [zodProbeViolation]);
  expect(served.unanswered).toEqual([]);
}
