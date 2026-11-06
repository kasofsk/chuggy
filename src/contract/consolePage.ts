/**
 * The console pages a member can be looking at, each named with the one thing
 * on it a reader would ask about: the ticket, the repository, the settings
 * section.
 *
 * IT IS THE CONTRACT BECAUSE MORE THAN ONE SIDE READS IT. The console names the
 * page its reader is on when they message their thread, and the interpreter
 * writes that page into the turn in front of what they typed, so the agent
 * answering knows what "this ticket" is. A page the vocabulary does not name is
 * not sent at all, rather than sent as a page it is not.
 */

import { z } from "zod";

import {
  isBoundedText,
  repositoryIdentityCharsMax,
  ticketNumberSchema,
} from "./http.ts";

/** Which of a project's settings pages, by the level it sets and the page's own name. */
export const consolePageSettingsSections = [
  "ProjectLead",
  "ProjectPlacement",
  "ProjectPermissions",
  "WorkspacePeople",
  "WorkspaceAccounts",
  "WorkspacePermissions",
  "WorkspaceRunners",
  "WorkspaceUsage",
  "SiteWorkspaces",
  "SitePermissions",
] as const;
export type ConsolePageSettingsSection =
  (typeof consolePageSettingsSections)[number];

/** A repository as a page names it: the binding's identity, on one line, since
 * a turn writes each field of a page as a line of its own. */
const consolePageRepositorySchema = z
  .string()
  .refine(
    (value) =>
      isBoundedText(value, repositoryIdentityCharsMax) &&
      !/\p{Cc}/u.test(value),
  );

/**
 * One page, as a variant per page the console draws. A new ticket names either
 * the ticket its address says it duplicates or the draft its address names,
 * never both, so it is two variants under the one page and the union is not
 * discriminated on the page alone.
 */
export const consolePageSchema = z.union([
  z.strictObject({ page: z.literal("Tickets") }),
  z.strictObject({ page: z.literal("Ticket"), ticket: ticketNumberSchema }),
  z.strictObject({ page: z.literal("TicketEdit"), ticket: ticketNumberSchema }),
  z.strictObject({
    page: z.literal("TicketNew"),
    from: ticketNumberSchema.optional(),
  }),
  z.strictObject({ page: z.literal("TicketNew"), draft: ticketNumberSchema }),
  z.strictObject({ page: z.literal("Inbox") }),
  z.strictObject({ page: z.literal("Lead") }),
  z.strictObject({ page: z.literal("Catalog") }),
  z.strictObject({ page: z.literal("Repositories") }),
  z.strictObject({
    page: z.literal("Repository"),
    repository: consolePageRepositorySchema,
  }),
  z.strictObject({ page: z.literal("Runners") }),
  z.strictObject({
    page: z.literal("Settings"),
    section: z.enum(consolePageSettingsSections).optional(),
  }),
]);

export type ConsolePage = z.infer<typeof consolePageSchema>;
