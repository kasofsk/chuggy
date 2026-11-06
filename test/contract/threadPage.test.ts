/**
 * The page section a turn carries, written and read by the one contract file,
 * so a reader gets back every page the writer was handed and the section's
 * text is what a reader that knows nothing of pages leaves in place.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  consolePageSchema,
  consolePageSettingsSections,
  type ConsolePage,
} from "../../src/contract/consolePage.ts";
import { repositoryIdentityCharsMax } from "../../src/contract/http.ts";
import {
  threadPageHeading,
  threadPageRead,
  threadPageSection,
} from "../../src/contract/threadSeeding.ts";

const pages: readonly ConsolePage[] = [
  { page: "Tickets" },
  { page: "Ticket", ticket: 41 },
  { page: "TicketEdit", ticket: 41 },
  { page: "TicketNew" },
  { page: "TicketNew", from: 12 },
  { page: "TicketNew", draft: 7 },
  { page: "Inbox" },
  { page: "Lead" },
  { page: "Catalog" },
  { page: "Repositories" },
  { page: "Repository", repository: "github.com/acme/atlas" },
  { page: "Repository", repository: "1234" },
  { page: "Repository", repository: "r".repeat(repositoryIdentityCharsMax) },
  { page: "Runners" },
  { page: "Settings" },
  ...consolePageSettingsSections.map((section): ConsolePage => ({
    page: "Settings",
    section,
  })),
];

test("the pages read back cover every variant the vocabulary has", () => {
  for (const [at, option] of consolePageSchema.options.entries())
    assert.ok(
      pages.some((page) => option.safeParse(page).success),
      `variant ${String(at)}`,
    );
});

test("every page a section is written for is read back off it", () => {
  for (const page of pages) {
    assert.deepEqual(threadPageRead(threadPageSection(page)), {
      before: "",
      page,
    });
    assert.deepEqual(
      threadPageRead(
        `# How you act on this project\n\n- rules\n\n${threadPageSection(page)}`,
      ),
      { before: "# How you act on this project\n\n- rules", page },
    );
  }
});

test("a block with no page section, or one naming no page, is answered whole", () => {
  for (const block of [
    "",
    "# How you act on this project\n\n- rules",
    `${threadPageHeading}\n\n- page: Thread`,
    `${threadPageHeading}\n\n- page: Ticket`,
    `${threadPageHeading}\n\n- page: Ticket\n- ticket: forty-one`,
    `${threadPageHeading}\n\n- page: Ticket\n- ticket: 41\nand more`,
  ])
    assert.deepEqual(threadPageRead(block), { before: block });
});
