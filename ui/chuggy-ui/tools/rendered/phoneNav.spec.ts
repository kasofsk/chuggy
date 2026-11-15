/**
 * The project's places on a phone, over the tickets list and a ticket's page
 * with the chat strip under them: a bar along the foot of the screen whose
 * items each show their name, the current one marked, each at least the touch
 * height and clear of the screen's unsafe edges. The header, the page, the
 * strip and the bar are stacked in that order with none over another, nothing
 * scrolls the page sideways, and the open chat lies over the bar rather than
 * under it, every place still one press away and pressing one giving back
 * the strip. At the desk the places stay the bar's row above
 * the page, the inbox beside the account menu, and no bar is drawn at the
 * foot.
 */

import {
  expect,
  renderedNoOverflow,
  renderedNoViolations,
  renderedOpen,
  renderedSafeAreaInsets,
  renderedTouchTargets,
  renderedViewports,
  test,
} from "./driver.ts";
import type { Locator, Page } from "@playwright/test";

import type { Rendered, RenderedInsets, RenderedOpening } from "./driver.ts";
import { stubApiProject, stubApiTenant } from "./stubApi.ts";

const zodProbeViolation = { directive: "script-src", blocked: "eval" };

const projectRoute = `/${stubApiTenant}/${stubApiProject}`;

const phoneScreens: readonly {
  readonly name: string;
  readonly opening: RenderedOpening;
}[] = [
  {
    name: "the tickets list",
    opening: {
      route: `${projectRoute}/`,
      viewport: "phone",
      signedIn: true,
      ready: (page) => page.getByRole("link", { name: "#1", exact: true }),
    },
  },
  {
    name: "a ticket's page",
    opening: {
      route: `${projectRoute}/tickets/1`,
      viewport: "phone",
      signedIn: true,
      ready: (page) =>
        page.getByRole("heading", { level: 1, name: "Ticket #1" }),
    },
  },
];

/** A notch's height above, a home indicator's below, and the rounded
 * corners' at each side, as a phone held upright reports them. */
const phoneInsets: RenderedInsets = { top: 32, right: 8, bottom: 34, left: 8 };

interface PhoneBox {
  readonly top: number;
  readonly bottom: number;
}

/** The boxes the frame stacks, top to bottom, once the frame has laid them. */
async function phoneStacked(
  rendered: Rendered,
): Promise<Readonly<Record<string, PhoneBox | undefined>>> {
  return rendered.page.evaluate(() => {
    const boxOf = (selector: string): PhoneBox | undefined => {
      const element = document.querySelector(selector);
      if (element === null) return undefined;
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom };
    };
    return {
      header: boxOf("header.topbar"),
      page: boxOf("[data-panel]#pages"),
      strip: boxOf("[data-panel]#chat-bottom"),
      bar: boxOf("nav.topbar-phone"),
    };
  });
}

/** Whether each box ends where the next begins or above it, and the last at
 * the foot of the viewport. */
function phoneInOrder(
  stacked: Readonly<Record<string, PhoneBox | undefined>>,
  height: number,
): boolean {
  const boxes = [stacked.header, stacked.page, stacked.strip, stacked.bar];
  if (boxes.some((box) => box === undefined)) return false;
  const laid = boxes as readonly PhoneBox[];
  const ordered = laid.every(
    (box, at) => at === 0 || (laid[at - 1]?.bottom ?? 0) <= box.top + 0.5,
  );
  return ordered && Math.abs((laid.at(-1)?.bottom ?? 0) - height) < 0.5;
}

/** Every item clear of the screen's unsafe edges. */
async function phoneItemsSafe(items: Locator): Promise<void> {
  const unsafe = await items.evaluateAll(
    (links, insets) =>
      links
        .map((link) => link.getBoundingClientRect())
        .filter(
          (box) =>
            box.left < insets.left - 0.5 ||
            box.right > window.innerWidth - insets.right + 0.5 ||
            box.bottom > window.innerHeight - insets.bottom + 0.5,
        ).length,
    phoneInsets,
  );
  expect(unsafe, "an item under the screen's unsafe edges").toBe(0);
}

/** The open chat, the composer at its foot, stacked over the bar, which
 * stays at the foot of the viewport. */
async function phoneChatOverBar(page: Page, bar: Locator): Promise<void> {
  const height = renderedViewports.phone.height;
  const chat = page.getByRole("region", { name: "Chat", exact: true });
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
  await expect
    .poll(
      async () => {
        const [over, under] = await Promise.all([
          chat.boundingBox(),
          bar.boundingBox(),
        ]);
        return (
          over !== null &&
          under !== null &&
          over.y + over.height <= under.y + 0.5 &&
          Math.abs(under.y + under.height - height) < 0.5
        );
      },
      { message: "the open chat, the composer at its foot, over the bar" },
    )
    .toBe(true);
}

for (const screen of phoneScreens)
  test(`on a phone ${screen.name} names every place along the foot of the screen, under the chat and the page and over none of them`, async ({
    browser,
    served,
  }) => {
    const rendered = await renderedOpen(browser, served.origin, screen.opening);
    const page = rendered.page;
    await renderedSafeAreaInsets(page, phoneInsets);
    const bar = page.getByRole("navigation", { name: "Console" });
    await expect(bar).toHaveCount(1);
    const items = bar.getByRole("link");
    await expect(items).toHaveText(["Tickets", "Epics", "Inbox"]);
    for (const word of ["Tickets", "Epics", "Inbox"])
      await expect(bar.getByText(word, { exact: true })).toBeVisible();
    await expect(
      bar.locator("[aria-current='page']"),
      "the current place is Tickets alone",
    ).toHaveText(["Tickets"]);
    await expect(
      page.locator("header.topbar").getByRole("link", { name: /^Inbox/u }),
      "the inbox has left the header for the bar",
    ).toHaveCount(0);
    const height = renderedViewports.phone.height;
    await expect
      .poll(async () => phoneInOrder(await phoneStacked(rendered), height), {
        message: "the header, the page, the strip and the bar, stacked",
      })
      .toBe(true);
    await expect(
      page.getByRole("button", { name: "Expand chat" }),
    ).toBeVisible();
    await renderedTouchTargets(page, bar);
    await phoneItemsSafe(items);
    await renderedNoOverflow(page);
    await page.getByRole("button", { name: "Expand chat" }).click();
    await phoneChatOverBar(page, bar);
    await renderedNoOverflow(page);
    await bar.getByRole("link", { name: "Inbox" }).click();
    await expect(
      page.getByRole("button", { name: "Expand chat" }),
      "a place pressed from the open chat gives back the strip",
    ).toBeVisible();
    await expect(bar.locator("[aria-current='page']")).toHaveText(["Inbox"]);
    renderedNoViolations(rendered, [zodProbeViolation]);
    expect(served.unanswered).toEqual([]);
  });

test("at the desk the places are the bar's row above the page and the inbox sits beside the account menu, with no bar at the foot", async ({
  browser,
  served,
}) => {
  const rendered = await renderedOpen(browser, served.origin, {
    route: `${projectRoute}/`,
    viewport: "desk",
    signedIn: true,
    ready: (page) => page.getByRole("link", { name: "#1", exact: true }),
  });
  const page = rendered.page;
  await expect(
    page.getByRole("navigation", { name: "Console" }).getByRole("link"),
  ).toHaveText(["Tickets", "Epics"]);
  await expect(
    page.locator("header.topbar").getByRole("link", { name: /^Inbox/u }),
  ).toBeVisible();
  await expect(page.locator("nav.topbar-phone")).toHaveCount(0);
  renderedNoViolations(rendered, [zodProbeViolation]);
  expect(served.unanswered).toEqual([]);
});
