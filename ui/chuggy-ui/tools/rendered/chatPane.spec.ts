/**
 * The open chat pane over the tickets list, at a phone's width and the desk's.
 * Its header is the title, at most two buttons and the menu, none of it
 * scrolls the page sideways, and on the phone every control of the header is
 * at least the touch height and Back leaves the page under it. The pane holds
 * no thread, since the stub lists none, so it is titled New chat.
 */

import {
  expect,
  renderedNoOverflow,
  renderedNoViolations,
  renderedOpen,
  renderedTouchTargets,
  test,
} from "./driver.ts";
import type { RenderedViewport } from "./driver.ts";
import { stubApiProject, stubApiTenant } from "./stubApi.ts";

const zodProbeViolation = { directive: "script-src", blocked: "eval" };

const chatPaneViewports: readonly RenderedViewport[] = ["phone", "desk"];

for (const viewport of chatPaneViewports)
  test(`the open chat pane's header is a title, two buttons and a menu, and does not scroll sideways on the ${viewport}`, async ({
    browser,
    served,
  }) => {
    const rendered = await renderedOpen(browser, served.origin, {
      route: `/${stubApiTenant}/${stubApiProject}/`,
      viewport,
      signedIn: true,
      ready: (page) => page.getByRole("link", { name: "#1", exact: true }),
    });
    const page = rendered.page;
    const phone = viewport === "phone";
    if (phone) await page.getByRole("button", { name: "Expand chat" }).click();
    const pane = page.getByRole("region", { name: "Chat", exact: true });
    const header = pane.locator("header");
    await expect(
      header.getByRole("heading", { level: 2, name: "New chat" }),
    ).toBeVisible();
    await expect(header.getByRole("button")).toHaveText(
      phone ? ["Back", "New", ""] : ["New", "Collapse", ""],
    );
    await expect(
      header.getByRole("button", { name: "Chat menu" }),
    ).toBeVisible();
    await renderedNoOverflow(page);
    if (phone) await renderedTouchTargets(page, header);
    await header.getByRole("button", { name: "Chat menu" }).click();
    await expect(page.getByRole("menuitem")).toHaveText(
      phone ? ["History"] : ["History", "Full screen"],
    );
    await renderedNoOverflow(page);
    await page.keyboard.press("Escape");
    if (phone) {
      await header.getByRole("button", { name: "Back" }).click();
      await expect(pane).toBeHidden();
      await expect(
        page.getByRole("button", { name: "Expand chat" }),
      ).toBeVisible();
    }
    renderedNoViolations(rendered, [zodProbeViolation]);
    expect(served.unanswered).toEqual([]);
  });
