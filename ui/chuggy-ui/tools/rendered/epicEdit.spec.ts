/**
 * The epic's edit page at a phone's width under a coarse pointer: the page
 * does not scroll sideways and nothing in the form is past its edge (the
 * epic's tab strip above it scrolls inside itself), every box and press in the form is at least the
 * touch height, its Save and Cancel are stacked to the form's width in that
 * order, and focusing a field draws its text at the size a phone types into
 * without zooming, the page's scale left as it was.
 */

import {
  expect,
  renderedComputedStyle,
  renderedNoOverflow,
  renderedNoViolations,
  renderedOpen,
  renderedTokenPixels,
  renderedTouchTargets,
  test,
} from "./driver.ts";
import { stubApiProject, stubApiTenant } from "./stubApi.ts";

const zodProbeViolation = { directive: "script-src", blocked: "eval" };

test("on a phone the epic's edit form scrolls nothing sideways, gives every box and press the touch height, stacks its actions, and focusing a field does not zoom", async ({
  browser,
  served,
}) => {
  const rendered = await renderedOpen(browser, served.origin, {
    route: `/${stubApiTenant}/${stubApiProject}/epics/1/edit`,
    viewport: "phone",
    touch: true,
    signedIn: true,
    ready: (page) => page.getByRole("textbox", { name: "Title" }),
  });
  const page = rendered.page;
  const form = page.locator("form.epic-form");
  await renderedNoOverflow(page, form);
  await renderedTouchTargets(page, form);

  const save = await form.getByRole("button", { name: "Save" }).boundingBox();
  const cancel = await form
    .getByRole("button", { name: "Cancel" })
    .boundingBox();
  const stacked = await form.boundingBox();
  expect(save, "Save is drawn").not.toBeNull();
  expect(cancel, "Cancel is drawn").not.toBeNull();
  expect(cancel?.y ?? 0).toBeGreaterThan(save?.y ?? Infinity);
  for (const pressed of [save, cancel]) {
    expect(pressed?.x).toBeCloseTo(stacked?.x ?? Infinity, 0);
    expect(pressed?.width).toBeCloseTo(stacked?.width ?? 0, 0);
  }

  const unzoomed = await renderedTokenPixels(page, "--text-unzoomed");
  expect(unzoomed, "the root states no --text-unzoomed").toBeGreaterThan(0);
  for (const name of ["Title", "Summary", "Description"]) {
    const field = form.getByRole("textbox", { name });
    await field.focus();
    await expect(field).toBeFocused();
    expect(
      Number.parseFloat(await renderedComputedStyle(field, "font-size")),
      `${name} is typed in smaller than a phone types without zooming`,
    ).toBeGreaterThanOrEqual(unzoomed);
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
  }
  await renderedNoOverflow(page, form);
  renderedNoViolations(rendered, [zodProbeViolation]);
  expect(served.unanswered).toEqual([]);
});
