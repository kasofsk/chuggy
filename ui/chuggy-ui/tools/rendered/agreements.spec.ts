/**
 * The page a signed-in person agrees to the deployment's policies on, at a
 * phone's width and pressed by a finger, listing two: nothing scrolls the
 * page sideways, and its two links and its two buttons are each at least the
 * touch height. And, at the phone's width and the desk's, an open console
 * whose read the API refuses for want of agreement: the standing names a
 * policy not agreed to, the page takes the console's place, and once the
 * person agrees the console is drawn again with that read's own content.
 */

import type { Page } from "@playwright/test";

import { agreementStandingSchema } from "../../../../src/contract/agreementPlane.ts";
import type { AgreementStanding } from "../../../../src/contract/agreementPlane.ts";
import { errorEnvelopeSchema } from "../../../../src/contract/http.ts";
import { themeChoiceResponseSchema } from "../../../../src/contract/responses.ts";
import { agreementRequiredCode } from "../../../../src/contract/rosters.ts";

import {
  expect,
  renderedDist,
  renderedNoOverflow,
  renderedNoViolations,
  renderedOpen,
  renderedTouchTargets,
  test,
} from "./driver.ts";
import { servedWhile } from "./served.ts";
import { stubApiProject, stubApiRead, stubApiTenant } from "./stubApi.ts";

const zodProbeViolation = { directive: "script-src", blocked: "eval" };

const digest = `sha256:${"0".repeat(64)}`;

const agreementsTerms = {
  policy: "terms",
  title: "Terms of Service",
  version: "2026-12-01",
  url: "https://policies.example/terms/2026-12-01",
  digest,
};

const agreementsPrivacy = {
  policy: "privacy",
  title: "Privacy Policy",
  version: "2026-12-01",
  url: "https://policies.example/privacy/2026-12-01",
  digest,
};

const agreementsReads = [
  stubApiRead("/agreements/v1/standing", agreementStandingSchema, {
    policies: [agreementsTerms, agreementsPrivacy],
  }),
];

test("the agreement page fits a phone, its two links and two buttons each a finger's height", async ({
  browser,
}) => {
  await servedWhile(
    {
      root: renderedDist,
      reads: agreementsReads,
      configuration: { agreements: true },
    },
    async (served) => {
      const rendered = await renderedOpen(browser, served.origin, {
        route: "/",
        viewport: "phone",
        signedIn: true,
        touch: true,
        ready: (page) =>
          page.getByRole("heading", { name: "Agree to continue" }),
      });
      const page = rendered.page;
      const main = page.locator("main");
      await expect(main.getByRole("link")).toHaveText([
        "Terms of Service",
        "Privacy Policy",
      ]);
      await expect(main.getByRole("button")).toHaveText([
        "Agree and continue",
        "Sign out",
      ]);
      await renderedNoOverflow(page);
      await renderedTouchTargets(page, main);
      renderedNoViolations(rendered, [zodProbeViolation]);
      expect(served.unanswered).toEqual([]);
    },
  );
});

const agreementsSettingsRoot = `/${stubApiTenant}/${stubApiProject}/settings`;
const agreementsChoicePath = "/api/v1/appearance/choice";
const agreementsAgreedAt = "2026-11-27T10:00:00Z";

/** Every read of the reader's theme choice refused for want of agreement
 * until the person agrees, and the standing naming the privacy policy
 * unagreed until then; once they agree, the choice is Harbour. */
async function agreementsRefusedUntilAgreed(page: Page): Promise<void> {
  let agreed = false;
  const standing = (): AgreementStanding =>
    agreementStandingSchema.parse({
      policies: [
        { ...agreementsTerms, agreedAt: agreementsAgreedAt },
        agreed
          ? { ...agreementsPrivacy, agreedAt: agreementsAgreedAt }
          : agreementsPrivacy,
      ],
    });
  await page.route(`**${agreementsChoicePath}`, async (route) => {
    await (agreed
      ? route.fulfill({
          json: themeChoiceResponseSchema.parse({
            choice: { kind: "BuiltIn", theme: "harbour" },
          }),
        })
      : route.fulfill({
          status: 403,
          json: errorEnvelopeSchema.parse({
            error: { code: agreementRequiredCode, message: "agree first" },
          }),
        }));
  });
  await page.route("**/agreements/v1/standing", async (route) => {
    await route.fulfill({ json: standing() });
  });
  await page.route("**/agreements/v1/agreements", async (route) => {
    agreed = true;
    await route.fulfill({ json: standing() });
  });
}

for (const viewport of ["phone", "desk"] as const)
  test(`at the ${viewport}'s width an open console whose read is refused for want of agreement draws the page, and agreeing draws the console again with that read's content`, async ({
    browser,
    served,
  }) => {
    const rendered = await renderedOpen(browser, served.origin, {
      route: agreementsSettingsRoot,
      viewport,
      signedIn: true,
      ready: (page) => page.getByRole("navigation", { name: "Settings" }),
    });
    const page = rendered.page;
    await agreementsRefusedUntilAgreed(page);
    await page
      .getByRole("navigation", { name: "Settings" })
      .getByRole("link", { name: "Preferences", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Agree to continue" }),
    ).toBeVisible();
    await expect(page.locator("main").getByRole("link")).toHaveText([
      "Privacy Policy",
    ]);
    await expect(page.getByRole("status")).toHaveCount(0);
    await renderedNoOverflow(page);
    await page.getByRole("button", { name: "Agree and continue" }).click();
    const theme = page.getByRole("radiogroup", { name: "Theme" });
    await expect(theme.getByRole("radio", { checked: true })).toHaveText(
      "Harbour",
    );
    renderedNoViolations(rendered, [zodProbeViolation]);
  });
