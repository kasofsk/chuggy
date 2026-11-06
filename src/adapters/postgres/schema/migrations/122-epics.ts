/**
 * A project keeps epics: titled groups of tickets that are documentation only.
 *
 * `epic` HOLDS THE CURRENT REVISION, `epic_change` EVERY REVISION. The change
 * row carries the whole content it saved, so history is read from it and the
 * current row is the latest change, written in the same transaction.
 *
 * `epic_ticket` HOLDS NO FOREIGN KEY TO A TICKET. A ticket lives in the
 * journal, not in a relation, and the decision that saves an epic has already
 * refused a member the project did not hold. Its index serves the read that
 * asks which epics a ticket belongs to.
 *
 * NUMBERING IS `max(number) + 1` UNDER THE PROJECT ROW'S LOCK, the lock
 * `project.ingress_next` allocation takes, so a creation committing first
 * leaves the next one the following number and no number is skipped. No
 * counter row is kept: it would restate what the epics already say.
 *
 * Only the relations arrive here; the door that writes them is a later change,
 * so no role but the boundary owner holds a grant yet.
 */

import {
  epicContentBytesMax,
  epicSummaryCharsMax,
  epicTitleCharsMax,
} from "../../../../domain/epics.ts";
import { boundaryOwnerRole, type Migration } from "../shared.ts";

/** The columns a revision's content is held in, on the current row and on each change alike. */
function contentColumns(relation: string): string {
  return `title text NOT NULL
         CONSTRAINT ${relation}_title_is_bounded
         CHECK (length(btrim(title)) >= 1
                AND length(title) <= ${String(epicTitleCharsMax)}),
       summary text
         CONSTRAINT ${relation}_summary_is_bounded
         CHECK (summary IS NULL OR (length(btrim(summary)) >= 1
                AND length(summary) <= ${String(epicSummaryCharsMax)})),
       description text NOT NULL
         CONSTRAINT ${relation}_description_is_bounded
         CHECK (octet_length(description) <= ${String(epicContentBytesMax)}),
       visibility text NOT NULL
         CONSTRAINT ${relation}_visibility_is_known
         CHECK (visibility IN ('Active','Archived'))`;
}

export const migration122: Migration = {
  version: 122,
  name: "a project keeps epics, the groups of tickets it documents",
  statements: [
    `CREATE TABLE public.epic (
       tenant text NOT NULL,
       project text NOT NULL,
       number bigint NOT NULL
         CONSTRAINT epic_number_is_positive CHECK (number >= 1),
       revision bigint NOT NULL
         CONSTRAINT epic_revision_is_positive CHECK (revision >= 1),
       ${contentColumns("epic")},
       PRIMARY KEY (tenant,project,number),
       CONSTRAINT epic_names_a_project
         FOREIGN KEY (tenant,project) REFERENCES public.project(tenant,project))`,
    `CREATE TABLE public.epic_ticket (
       tenant text NOT NULL,
       project text NOT NULL,
       epic bigint NOT NULL,
       ticket bigint NOT NULL
         CONSTRAINT epic_ticket_is_positive CHECK (ticket >= 1),
       PRIMARY KEY (tenant,project,epic,ticket),
       CONSTRAINT epic_ticket_names_an_epic
         FOREIGN KEY (tenant,project,epic) REFERENCES public.epic(tenant,project,number))`,
    `CREATE INDEX epic_ticket_by_ticket ON public.epic_ticket(tenant,project,ticket)`,
    `CREATE TABLE public.epic_change (
       tenant text NOT NULL,
       project text NOT NULL,
       epic bigint NOT NULL,
       revision bigint NOT NULL
         CONSTRAINT epic_change_revision_is_positive CHECK (revision >= 1),
       changed_at timestamp with time zone NOT NULL DEFAULT now(),
       actor_kind text NOT NULL
         CONSTRAINT epic_change_actor_kind_is_bounded
         CHECK (length(actor_kind) BETWEEN 1 AND 256),
       actor_subject text NOT NULL
         CONSTRAINT epic_change_actor_subject_is_bounded
         CHECK (length(actor_subject) BETWEEN 1 AND 256),
       ${contentColumns("epic_change")},
       tickets bigint[] NOT NULL
         CONSTRAINT epic_change_tickets_are_positive
         CHECK (1 <= all (tickets)),
       PRIMARY KEY (tenant,project,epic,revision),
       CONSTRAINT epic_change_names_a_project
         FOREIGN KEY (tenant,project) REFERENCES public.project(tenant,project))`,
    `CREATE TRIGGER epic_change_is_immutable BEFORE DELETE OR UPDATE ON public.epic_change
       FOR EACH ROW EXECUTE FUNCTION public.project_creation_is_immutable()`,
    `GRANT SELECT,INSERT,UPDATE ON TABLE public.epic TO ${boundaryOwnerRole}`,
    `GRANT SELECT,INSERT,DELETE ON TABLE public.epic_ticket TO ${boundaryOwnerRole}`,
    `GRANT SELECT,INSERT ON TABLE public.epic_change TO ${boundaryOwnerRole}`,
  ],
};
