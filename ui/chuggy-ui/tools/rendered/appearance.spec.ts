/**
 * A project's Appearance page, to an administrator, at the phone's width and
 * the desk's under the served policy: the project keeps a default theme, an
 * icon and a banner, and every preview of them loads its image with no
 * violation reported, the page does not scroll sideways, and on the phone
 * every control under the page's own section is the touch height.
 */

import { builtInThemes } from "../../../../src/contract/appearance.ts";
import {
  projectAbilitiesResponseSchema,
  projectArtifactResponseSchema,
  projectImagesResponseSchema,
  projectThemeResponseSchema,
} from "../../../../src/contract/responses.ts";
import {
  expect,
  renderedDist,
  renderedNoOverflow,
  renderedNoViolations,
  renderedOpen,
  renderedTouchTargets,
  test,
} from "./driver.ts";
import { servedOpen } from "./served.ts";
import { stubApiProject, stubApiRead, stubApiTenant } from "./stubApi.ts";

const zodProbeViolation = { directive: "script-src", blocked: "eval" };

const projectPath = `/api/v1/tenants/${stubApiTenant}/projects/${stubApiProject}`;

/** A one-pixel PNG, which the page draws from its read as a `data:` URI. */
const pixel =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const appearanceReads = [
  stubApiRead(`${projectPath}/abilities`, projectAbilitiesResponseSchema, {
    principal: "issuer member",
    mutate: true,
    dispatch: true,
    manageSelector: true,
    overrideTicketConfig: true,
    skipPlannedEvaluations: true,
    administer: true,
    writeEpic: true,
  }),
  stubApiRead(`${projectPath}/appearance/theme`, projectThemeResponseSchema, {
    document: builtInThemes.harbour,
    administers: true,
  }),
  stubApiRead(`${projectPath}/appearance/images`, projectImagesResponseSchema, {
    icon: "artifact-icon",
    banner: "artifact-banner",
    administers: true,
  }),
  ...["artifact-icon", "artifact-banner"].map((artifact) =>
    stubApiRead(
      `${projectPath}/artifacts/${artifact}`,
      projectArtifactResponseSchema,
      { mediaType: "image/png", content: pixel, encoding: "base64" },
    ),
  ),
];

for (const viewport of ["phone", "desk"] as const)
  test(`at the ${viewport}'s width the appearance page loads every preview's image under the policy with no sideways scroll${viewport === "phone" ? " and every control the touch height" : ""}`, async ({
    browser,
  }) => {
    const served = await servedOpen({
      root: renderedDist,
      reads: appearanceReads,
    });
    try {
      const rendered = await renderedOpen(browser, served.origin, {
        route: `/${stubApiTenant}/${stubApiProject}/settings/appearance`,
        viewport,
        touch: viewport === "phone",
        signedIn: true,
        ready: (page) =>
          page.getByRole("radiogroup", { name: "Default theme" }),
      });
      const page = rendered.page;
      await expect(
        page
          .getByRole("radiogroup", { name: "Default theme" })
          .getByRole("radio", { checked: true }),
      ).toHaveText("Harbour");
      const images = page.locator(".appearance img");
      await expect(images).toHaveCount(6);
      await expect(
        page.getByRole("img", { name: stubApiProject, exact: true }),
      ).toHaveCount(4);
      for (const image of await images.all())
        await expect
          .poll(() =>
            image.evaluate(
              (drawn: HTMLImageElement) => drawn.complete && drawn.naturalWidth,
            ),
          )
          .toBe(1);
      await renderedNoOverflow(page);
      if (viewport === "phone")
        await renderedTouchTargets(page, page.locator(".settings-section"));
      else
        await expect(
          page
            .getByRole("navigation", { name: "Settings" })
            .getByRole("link", { name: "Appearance" }),
        ).toBeVisible();
      renderedNoViolations(rendered, [zodProbeViolation]);
      expect(served.unanswered).toEqual([]);
    } finally {
      await served.close();
    }
  });
