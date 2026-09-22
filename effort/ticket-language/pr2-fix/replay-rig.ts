/** Replays the rig's exported journals through one image's reader, and says where a refusal falls. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const [srcRoot, exportPath] = process.argv.slice(2);
if (srcRoot === undefined || exportPath === undefined)
  throw new Error("usage: replay-rig.ts <src root> <vteng.jsonl>");

const journal = await import(resolve(srcRoot, "actor/journal.ts"));
const semanticsModule = await import(resolve(srcRoot, "actor/decisionSemantics.ts"));
const decisionEvent = await import(resolve(srcRoot, "actor/decisionEvent.ts"));
const equality = await import(resolve(srcRoot, "actor/equality.ts"));
const wire = await import(resolve(srcRoot, "interpreter/wire.ts"));

const config = { nTickets: 256, nTasks: 8, maxStages: 4 };

interface Exported {
  project: string;
  seq: number;
  semantics: number;
  event_schema: number;
  entry: string;
}

const rows: Exported[] = readFileSync(exportPath, "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line) as Exported);

const byProject = new Map<string, Exported[]>();
for (const row of rows) {
  const held = byProject.get(row.project) ?? [];
  held.push(row);
  byProject.set(row.project, held);
}

for (const [project, held] of byProject) {
  const ordered = [...held].sort((a, b) => a.seq - b.seq);
  const stored = ordered.map((row) => {
    if (!semanticsModule.isDecisionSemanticsVersion(row.semantics))
      throw new Error(`${project} row ${row.seq} declares semantics ${row.semantics}`);
    const parsed = wire.parseStoredEntry(JSON.parse(row.entry), row.semantics);
    if (parsed.parsed === "Refused")
      throw new Error(`${project} row ${row.seq} is unreadable: ${parsed.why}`);
    return { entry: parsed.value, semantics: row.semantics };
  });

  const cascades = stored.filter(
    (row) => row.entry.rec.label === "ticket-revoked" && row.entry.rec.transitions.length > 1,
  );
  const legal = journal.storedJournalLegalOn(config, stored);
  console.log(
    `${project}: ${stored.length} row(s), semantics ${[...new Set(stored.map((r) => r.semantics))].sort().join("/")}, ` +
      `${cascades.length} cascade row(s) at seq ${cascades.map((r) => r.entry.seq).join(",")} — ` +
      `storedJournalLegalOn = ${legal}`,
  );
  if (legal) {
    const core = journal.storedReplayCore(stored);
    const phases = new Map<string, number>();
    for (const ticket of core.tickets.values())
      phases.set(ticket.phase, (phases.get(ticket.phase) ?? 0) + 1);
    console.log(
      `  replayed ${core.tickets.size} ticket(s): ${[...phases].map(([p, n]) => `${p} ${n}`).join(", ")}`,
    );
    continue;
  }

  let replayed = journal.genesis;
  let semantics = 1;
  let next = 1;
  for (const row of stored) {
    const why =
      !semanticsModule.replayableDecision(row.entry)
        ? "replayableDecision"
        : row.semantics < semantics
          ? "semantics order"
          : row.entry.seq !== next
            ? "seq"
            : !decisionEvent.decisionEventEnabled(config, replayed, row.entry.event)
              ? "decisionEventEnabled"
              : undefined;
    if (why !== undefined) {
      console.log(`  refused at seq ${row.entry.seq} by ${why}`);
      console.log(`  label ${row.entry.rec.label}, transitions ${JSON.stringify(row.entry.rec.transitions)}`);
      break;
    }
    const decision = semanticsModule.execDecisionEventAt(row.semantics, replayed, row.entry);
    if (!equality.recordEquals(decision.rec, row.entry.rec)) {
      console.log(`  refused at seq ${row.entry.seq} by recordEquals`);
      console.log(`  label ${row.entry.rec.label}, transitions ${JSON.stringify(row.entry.rec.transitions)}`);
      console.log(`  re-derived ${JSON.stringify(decision.rec)}`);
      break;
    }
    replayed = decision.post;
    semantics = row.semantics;
    next += 1;
  }
}
