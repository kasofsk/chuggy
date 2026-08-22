/**
 * The sinks every telemetry case in this directory is driven with: one that
 * keeps what it was told and one that fails at everything.
 *
 * A ROSTER IS READ OFF THE SILENT SINK RATHER THAN WRITTEN DOWN. The silent
 * sink names every observation its service declares, so a sink built from its
 * keys covers the whole surface — an observation added later is recorded, and
 * failed, without this file being edited. A hand-written sink would pass the
 * day the surface grew and prove one method less every time after.
 *
 * ONE FILE SERVES EVERY SERVICE, because two sinks differing only in the type
 * they are cast to are one sink written twice.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Every observation a service declares, read off the sink that ignores them all. */
export function telemetryObservations(silent: object): readonly string[] {
  return Object.keys(silent).sort();
}

/** What a sink is handed, which is a label or a count and never a payload. */
type Observed = string | number | undefined;

/** One sink built by giving every declared observation the same body. */
function telemetrySink<Metrics>(
  names: readonly string[],
  body: (name: string) => (...args: Observed[]) => void,
): Metrics {
  return Object.fromEntries(
    names.map((name) => [name, body(name)]),
  ) as unknown as Metrics;
}

/** A sink that keeps what it was told, spelled so a case can assert the sequence. */
export function telemetryRecording<Metrics>(
  names: readonly string[],
  seen: string[],
): Metrics {
  return telemetrySink<Metrics>(names, (name) => (...args) => {
    seen.push([name, ...args.filter((arg) => arg !== undefined)].join(":"));
  });
}

/** A sink that fails at every observation, which is the loudest one can be. */
export function telemetryThrowing<Metrics>(
  names: readonly string[],
  thrown: string[],
): Metrics {
  return telemetrySink<Metrics>(names, (name) => () => {
    thrown.push(name);
    throw new Error(`telemetry ${name} failed`);
  });
}

const telemetrySourceRoot = join(import.meta.dirname, "..", "..", "src");

/** Every observation named at a call site in a source that holds the named recorder's sealed sink. */
export function telemetryEmitted(recorder: string): ReadonlySet<string> {
  const emitted = new Set<string>();
  for (const entry of readdirSync(telemetrySourceRoot, {
    recursive: true,
    encoding: "utf8",
  })) {
    if (!entry.endsWith(".ts")) continue;
    const source = readFileSync(join(telemetrySourceRoot, entry), "utf8");
    if (!source.includes(`${recorder}(`)) continue;
    for (const match of source.matchAll(/\bmetrics\.(\w+)\(/g)) {
      const name = match[1];
      if (name !== undefined) emitted.add(name);
    }
  }
  return emitted;
}
