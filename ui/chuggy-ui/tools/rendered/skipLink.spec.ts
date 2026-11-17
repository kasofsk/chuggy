/**
 * The link past the bar, drawn: clipped to nothing until the first Tab gives
 * it focus, then standing in the viewport, and pressed it gives the page's
 * `main` the focus, with the document titled for the page.
 */

import { renderedOpen, test } from "./driver.ts";
import type { RenderedOpening } from "./driver.ts";
import { stubApiProject, stubApiTenant } from "./stubApi.ts";

const ticketsList: RenderedOpening = {
  route: `/${stubApiTenant}/${stubApiProject}/`,
  viewport: "desk",
  signedIn: true,
  ready: (page) => page.getByText("#1", { exact: true }),
};

test("the first Tab shows the link past the bar, and Enter moves focus to the page's main", async ({
  browser,
  served,
}) => {
  const { page } = await renderedOpen(browser, served.origin, ticketsList);
  const skip = page.getByRole("link", { name: "Skip to content" });
  const clipped = await skip.evaluate(
    (element) => getComputedStyle(element).clipPath,
  );
  test.expect(clipped).not.toBe("none");
  await page.keyboard.press("Tab");
  await test.expect(skip).toBeFocused();
  test
    .expect(
      await skip.evaluate((element) => getComputedStyle(element).clipPath),
    )
    .toBe("none");
  await test.expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await test.expect(page.getByRole("main")).toBeFocused();
  test.expect(await page.title()).toBe(`tickets · ${stubApiProject}`);
});
