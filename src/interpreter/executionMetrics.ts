/**
 * What this installation exports about ticket execution, rendered in the text
 * exposition format a scrape reads.
 *
 * A SAMPLE IS A FACT THIS TREE HOLDS, not one a workload asserted about itself.
 * The costs and token counts are sums of what workloads reported, and are
 * labelled as such by their names; the states, the unreported attempts and the
 * silent workloads are the plane's own reading of its rows.
 *
 * LABEL VALUES ARE OPAQUE TEXT AND ARE ESCAPED AS SUCH. A tenant and a project
 * are never interpreted here, so both are escaped before they are labels rather
 * than assumed to contain nothing that would end one.
 */

/** One exported series: a name, its labels and the value at scrape time. */
export interface ExecutionMetricSample {
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly value: number;
}

/** What each exported name means and how a scrape should read it. */
export const executionMetricHelp: Readonly<Record<string, string>> = {
  chug_ticket_executions: "Ticket executions held, by state.",
  chug_ticket_execution_attempts_unreported:
    "Attempts that were claimed and expired having reported nothing.",
  chug_ticket_execution_workloads_silent:
    "Running claims whose workload has not reported inside the silence bound.",
  chug_ticket_execution_run_cost_usd_micros:
    "Cost in USD micros, as reported by the workloads that spent it.",
  chug_ticket_execution_run_tokens:
    "Tokens, as reported by the workloads that spent them.",
  chug_ticket_execution_run_turns:
    "Turns, as reported by the workloads that took them.",
};

const executionMetricTypes: Readonly<Record<string, string>> = {
  chug_ticket_executions: "gauge",
  chug_ticket_execution_attempts_unreported: "gauge",
  chug_ticket_execution_workloads_silent: "gauge",
  chug_ticket_execution_run_cost_usd_micros: "counter",
  chug_ticket_execution_run_tokens: "counter",
  chug_ticket_execution_run_turns: "counter",
};

/** A label value as the exposition format spells one, which three characters end. */
function escaped(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n");
}

function labelled(labels: Readonly<Record<string, string>>): string {
  const held = Object.entries(labels)
    .filter(([, value]) => value.length > 0)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, value]) => `${name}="${escaped(value)}"`);
  return held.length === 0 ? "" : `{${held.join(",")}}`;
}

/**
 * Renders every sample, each name declared once before the series that carry
 * it. A name with no samples is still declared, so a scrape can tell a figure
 * of zero from a figure this installation does not export.
 */
export function executionMetricsDocument(
  samples: readonly ExecutionMetricSample[],
): string {
  const lines: string[] = [];
  for (const name of Object.keys(executionMetricHelp)) {
    lines.push(`# HELP ${name} ${executionMetricHelp[name] ?? ""}`);
    lines.push(`# TYPE ${name} ${executionMetricTypes[name] ?? "untyped"}`);
    for (const sample of samples.filter((held) => held.name === name))
      lines.push(
        `${name}${labelled(sample.labels)} ${String(Math.round(sample.value))}`,
      );
  }
  return `${lines.join("\n")}\n`;
}
