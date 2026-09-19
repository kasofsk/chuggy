/**
 * What one attempt's run spent, as the plane a harness reaches takes it.
 *
 * A MEASURE IS THE WORKLOAD'S ACCOUNT OF ITSELF and is stored as that. The
 * durations and costs here are a machine's own reading of what it did, which
 * this tree cannot check and does not pretend to: what it holds instead is the
 * shape, the bounds and the attempt the numbers belong to. The instants are the
 * plane's, because a harness clock is no authority on when a row was stored.
 *
 * NOTHING HERE DECIDES ANYTHING. A measure settles no attempt, spends no retry
 * and moves no lease; it is read back by whoever asks what a run cost.
 */

/** The four token counts every measure of a run is broken down by. */
export interface TicketExecutionRunTokens {
  readonly tokensInput: number;
  readonly tokensOutput: number;
  readonly tokensCacheCreation: number;
  readonly tokensCacheRead: number;
}

export interface TicketExecutionRunTurn extends TicketExecutionRunTokens {
  readonly ordinal: number;
  readonly model: string;
}

export interface TicketExecutionRunModelUsage extends TicketExecutionRunTokens {
  readonly model: string;
  readonly costUsdMicros: number;
}

export interface TicketExecutionRunTotals extends TicketExecutionRunTokens {
  readonly turns: number;
  readonly durationMs: number;
  readonly durationApiMs: number;
  readonly costUsdMicros: number;
  readonly costBasis: "List";
  readonly permissionDenials: number;
  readonly models: readonly TicketExecutionRunModelUsage[];
  readonly resultSubtype?: string;
  readonly stopReason?: string;
}

/**
 * What became of one report of a measure. A redelivery of the same rows is the
 * same fact and answers as stored, so a harness that retried a report it never
 * saw acknowledged is never told its run conflicts with itself.
 */
export type TicketExecutionRunStored =
  "Stored" | "AlreadyStored" | "Conflict" | "Fenced";

/**
 * What storing a run's evidence found. `OutOfOrder` is a batch that is not the
 * next one, which a reader of a whole transcript could not page over.
 */
export type TicketExecutionRunEvidenceStored =
  TicketExecutionRunStored | "OutOfOrder" | "TooLarge" | "Unavailable";

/** Where a run's measures and evidence are written, under the bearer of the attempt they belong to. */
export interface TicketExecutionRunPort {
  turns(
    secret: string,
    turns: readonly TicketExecutionRunTurn[],
  ): Promise<TicketExecutionRunStored>;
  totals(
    secret: string,
    totals: TicketExecutionRunTotals,
  ): Promise<TicketExecutionRunStored>;
  transcript(
    secret: string,
    batch: number,
    content: Uint8Array,
  ): Promise<TicketExecutionRunEvidenceStored>;
  configuration(
    secret: string,
    content: Uint8Array,
  ): Promise<TicketExecutionRunEvidenceStored>;
}

/** A non-negative whole count, which is what every measured field here is. */
function runCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

/** A cost is a fraction of a dollar and is not whole until it is in micros. */
function runAmount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function runRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The four token counts an agent reports them under, which are not these names. */
function runTokens(usage: unknown): TicketExecutionRunTokens {
  const held = runRecord(usage) ?? {};
  return {
    tokensInput: runCount(held["input_tokens"] ?? held["inputTokens"]),
    tokensOutput: runCount(held["output_tokens"] ?? held["outputTokens"]),
    tokensCacheCreation: runCount(
      held["cache_creation_input_tokens"] ?? held["cacheCreationInputTokens"],
    ),
    tokensCacheRead: runCount(
      held["cache_read_input_tokens"] ?? held["cacheReadInputTokens"],
    ),
  };
}

function runBounded(value: unknown, charsMax: number): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, charsMax)
    : undefined;
}

/** What one assistant frame measures, if it measures a turn at all. */
function runTurnOf(
  frame: Record<string, unknown>,
  ordinal: number,
  modelCharsMax: number,
): TicketExecutionRunTurn | undefined {
  if (frame["type"] !== "assistant") return undefined;
  const message = runRecord(frame["message"]);
  if (message === undefined) return undefined;
  return {
    ordinal,
    model: runBounded(message["model"], modelCharsMax) ?? "unknown",
    ...runTokens(message["usage"]),
  };
}

/** The per-model breakdown an agent reports beside its own totals. */
function runModelsOf(
  value: unknown,
  modelCharsMax: number,
  modelsMax: number,
): readonly TicketExecutionRunModelUsage[] {
  const held = runRecord(value);
  if (held === undefined) return [];
  return Object.entries(held)
    .slice(0, modelsMax)
    .map(([model, usage]) => ({
      model: model.slice(0, modelCharsMax) || "unknown",
      ...runTokens(usage),
      costUsdMicros: Math.round(
        runAmount(runRecord(usage)?.["costUSD"]) * 1_000_000,
      ),
    }));
}

/**
 * Folds an agent's own event stream into the measure of one run. A stream that
 * ended before its runtime reported totals is measured from the turns that did
 * arrive, because a run that died still spent what it spent.
 */
export function ticketExecutionRunMeasured(
  stream: string,
  bounds: {
    readonly turnsMax: number;
    readonly modelCharsMax: number;
    readonly modelsMax: number;
    readonly reasonCharsMax: number;
  },
): {
  readonly turns: readonly TicketExecutionRunTurn[];
  readonly totals: TicketExecutionRunTotals;
} {
  const turns: TicketExecutionRunTurn[] = [];
  let result: Record<string, unknown> | undefined;
  for (const line of stream.split("\n")) {
    if (line.length === 0) continue;
    let frame: Record<string, unknown> | undefined;
    try {
      frame = runRecord(JSON.parse(line));
    } catch {
      continue;
    }
    if (frame === undefined) continue;
    if (frame["type"] === "result") result = frame;
    if (turns.length >= bounds.turnsMax) continue;
    const turn = runTurnOf(frame, turns.length + 1, bounds.modelCharsMax);
    if (turn !== undefined) turns.push(turn);
  }
  return { turns, totals: runTotalsOf(turns, result, bounds) };
}

/** What a run spent, as its runtime said, or as its turns say when it did not. */
function runTotalsOf(
  turns: readonly TicketExecutionRunTurn[],
  result: Record<string, unknown> | undefined,
  bounds: {
    readonly modelCharsMax: number;
    readonly modelsMax: number;
    readonly reasonCharsMax: number;
  },
): TicketExecutionRunTotals {
  const folded = turns.reduce<TicketExecutionRunTokens>(
    (held, turn) => ({
      tokensInput: held.tokensInput + turn.tokensInput,
      tokensOutput: held.tokensOutput + turn.tokensOutput,
      tokensCacheCreation: held.tokensCacheCreation + turn.tokensCacheCreation,
      tokensCacheRead: held.tokensCacheRead + turn.tokensCacheRead,
    }),
    {
      tokensInput: 0,
      tokensOutput: 0,
      tokensCacheCreation: 0,
      tokensCacheRead: 0,
    },
  );
  if (result === undefined)
    return {
      ...folded,
      turns: turns.length,
      durationMs: 0,
      durationApiMs: 0,
      costUsdMicros: 0,
      costBasis: "List",
      permissionDenials: 0,
      models: [],
    };
  const denials = result["permission_denials"];
  const subtype = runBounded(result["subtype"], bounds.reasonCharsMax);
  const stop = runBounded(result["stop_reason"], bounds.reasonCharsMax);
  return {
    ...runTokens(result["usage"] ?? folded),
    turns: runCount(result["num_turns"]) || turns.length,
    durationMs: runCount(result["duration_ms"]),
    durationApiMs: runCount(result["duration_api_ms"]),
    costUsdMicros: Math.round(runAmount(result["total_cost_usd"]) * 1_000_000),
    costBasis: "List",
    permissionDenials: Array.isArray(denials) ? denials.length : 0,
    models: runModelsOf(
      result["modelUsage"],
      bounds.modelCharsMax,
      bounds.modelsMax,
    ),
    ...(subtype === undefined ? {} : { resultSubtype: subtype }),
    ...(stop === undefined ? {} : { stopReason: stop }),
  };
}
