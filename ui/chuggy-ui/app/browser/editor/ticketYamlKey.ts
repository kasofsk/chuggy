/** A key the ticket YAML editor completes and explains, apart from the text it reads so every describer can name it. */

/** One value a key offers, with what choosing it does. */
export interface TicketYamlValue {
  readonly label: string;
  readonly detail?: string;
}

/** What the editor completes and explains: every key this project's form
 * draws, what it means, and the values it takes where they are a closed set. */
export interface TicketYamlKey {
  readonly key: string;
  readonly hint: string;
  readonly values: readonly TicketYamlValue[];
  /** Written inside a program's stage or a workload rather than at the top. */
  readonly place?: "Stage" | "Workload";
}
