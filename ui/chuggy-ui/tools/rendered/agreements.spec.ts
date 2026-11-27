/**
 * The page a signed-in person agrees to the deployment's policies on, at a
 * phone's width and pressed by a finger, listing two: nothing scrolls the
 * page sideways, and its two links and its two buttons are each at least the
 * touch height.
 */

import { agreementStandingSchema } from "../../../../src/contract/agreementPlane.ts";

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
import { stubApiRead } from "./stubApi.ts";

const zodProbeViolation = { directive: "script-src", blocked: "eval" };

const digest = `sha256:${"0".repeat(64)}`;

const agreementsReads = [
  stubApiRead("/agreements/v1/standing", agreementStandingSchema, {
    policies: [
      {
        policy: "terms",
        title: "Terms of Service",
        version: "2026-12-01",
        url: "https://policies.example/terms/2026-12-01",
        digest,
      },
      {
        policy: "privacy",
        title: "Privacy Policy",
        version: "2026-12-01",
        url: "https://policies.example/privacy/2026-12-01",
        digest,
      },
    ],
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
