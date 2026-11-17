/**
 * A thread's own page at a phone's width and the desk's, the phone's under a
 * coarse pointer with a home indicator along its foot: the title is the
 * page's one top heading, the conversation fills the page under the head with
 * its composer in view, at least the touch height and clear of the screen's
 * unsafe foot, and its column no wider than the reading measure.
 * Nothing scrolls the page sideways, every control of the head is at least
 * the touch height on the phone, the document asks a keyboard to resize the
 * page rather than cover it, and every read is one the stub answers.
 */

import { threadResponseSchema } from "../../../../src/contract/responses.ts";

import {
  expect,
  renderedNoOverflow,
  renderedNoViolations,
  renderedDist,
  renderedOpen,
  renderedSafeAreaInsets,
  renderedTokenPixels,
  renderedTouchTargets,
  test,
} from "./driver.ts";
import type { RenderedViewport } from "./driver.ts";
import { servedOpen } from "./served.ts";
import { stubApiProject, stubApiRead, stubApiTenant } from "./stubApi.ts";

const zodProbeViolation = { directive: "script-src", blocked: "eval" };

const threadPageViewports: readonly RenderedViewport[] = ["phone", "desk"];

const threadPageSession = "thread-rendered";

const threadPageTitle = "Why is the first ticket still pending";

/** The member's own open thread, which has reported no store yet. */
const threadPageRead = stubApiRead(
  `/api/v1/tenants/${stubApiTenant}/projects/${stubApiProject}/threads/${threadPageSession}`,
  threadResponseSchema,
  {
    session: threadPageSession,
    owner: "issuer member",
    state: "Open",
    mine: true,
    title: threadPageTitle,
    openedAt: "2026-11-01T00:00:00Z",
    lastActivityAt: "2026-11-02T00:00:00Z",
    hidden: false,
    turns: [],
    streams: [],
  },
);

/** The home indicator a phone reports along its foot. */
const threadPageInsetBottom = 34;

for (const viewport of threadPageViewports)
  test(`a thread's own page fills the screen under its head with its composer in view on the ${viewport}, and does not scroll sideways`, async ({
    browser,
  }) => {
    const served = await servedOpen({
      root: renderedDist,
      reads: [threadPageRead],
    });
    try {
      const phone = viewport === "phone";
      const rendered = await renderedOpen(browser, served.origin, {
        route: `/${stubApiTenant}/${stubApiProject}/threads/${threadPageSession}`,
        viewport,
        touch: phone,
        signedIn: true,
        ready: (page) => page.getByRole("textbox", { name: "Message" }),
      });
      const page = rendered.page;
      if (phone)
        await renderedSafeAreaInsets(page, {
          top: 0,
          right: 0,
          bottom: threadPageInsetBottom,
          left: 0,
        });
      await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
        "content",
        /interactive-widget=resizes-content/u,
      );
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      const header = page.locator("header.page-header");
      await expect(header.getByRole("heading", { level: 1 })).toHaveText(
        threadPageTitle,
      );
      const composer = page.getByRole("textbox", { name: "Message" });
      await expect(composer).toBeInViewport({ ratio: 1 });
      const send = page.getByRole("button", { name: "Send" });
      await expect(send).toBeInViewport({ ratio: 1 });
      const touch = await renderedTokenPixels(page, "--height-touch");
      const field = await composer.evaluate(
        (box) =>
          (box.closest(".conversation-field") ?? box).getBoundingClientRect()
            .height,
      );
      expect(field).toBeGreaterThanOrEqual(touch - 0.5);
      const foot = await send.evaluate(
        (button) => button.getBoundingClientRect().bottom,
      );
      expect(foot).toBeLessThanOrEqual(
        (page.viewportSize()?.height ?? 0) -
          (phone ? threadPageInsetBottom : 0),
      );
      const measure = await renderedTokenPixels(page, "--width-reading");
      const column = await page
        .getByRole("region", { name: "Conversation" })
        .locator(".conversation-column")
        .first()
        .evaluate((element) => element.getBoundingClientRect().width);
      expect(column).toBeLessThanOrEqual(measure + 0.5);
      await renderedNoOverflow(page);
      if (phone) await renderedTouchTargets(page, header);
      renderedNoViolations(rendered, [zodProbeViolation]);
      expect(served.unanswered).toEqual([]);
    } finally {
      await served.close();
    }
  });
