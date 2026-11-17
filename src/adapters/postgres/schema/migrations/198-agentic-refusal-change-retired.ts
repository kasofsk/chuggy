import type { Migration } from "../shared.ts";

/**
 * A refusal of the lead's stops appending a change, and `AgenticRefusal` leaves
 * the change log's kinds, since nothing serves or streams the ledger.
 *
 * ITS CHANGE ROWS ARE DELETED FIRST, because the narrowed
 * `project_change_kind_is_known` would refuse them and the change log's reader
 * refuses a kind it does not know. The ledger itself stays.
 */

/** The array a CHECK names its members in, written as the server reads it back. */
function textArray(values: readonly string[]): string {
  return `ARRAY[${values.map((value) => `'${value}'::text`).join(", ")}]`;
}

/** The kinds the baseline admitted, without `AgenticRefusal`. */
const changeKinds = [
  "Operation",
  "Ticket",
  "Draft",
  "Configuration",
  "Project",
  "Execution",
  "NativeAction",
  "Session",
];

export const migration198: Migration = {
  version: 198,
  name: "a refusal of the lead's appends no change",
  statements: [
    `DROP TRIGGER selector_refusal_appends_a_change ON public.selector_agentic_refusal`,
    `DROP FUNCTION public.selector_refusal_change()`,
    `DELETE FROM public.project_change WHERE kind = 'AgenticRefusal'`,
    `ALTER TABLE public.project_change
       DROP CONSTRAINT project_change_kind_is_known,
       ADD CONSTRAINT project_change_kind_is_known CHECK ((kind = ANY (${textArray(changeKinds)})))`,
  ],
};
