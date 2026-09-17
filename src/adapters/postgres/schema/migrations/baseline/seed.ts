export const leadDispatchesPerDecision = 3;
export const leadObservationTokensPerDecision = 17_525_063;

const baselineControls = {
  limits: {
    tokensPerDecision: leadObservationTokensPerDecision,
    concurrentDecisions: 4,
    selectionsPerMinute: 60,
    toolCallsPerDecision: 200,
    dispatchesPerDecision: leadDispatchesPerDecision,
    inputBytesPerDecision: 1048576,
    millisecondsPerDecision: 900000,
    candidatePagesPerDecision: 1,
  },
  toolAllowlist: [
    "Glob",
    "Grep",
    "Read",
    "mcp__chuggy__list_tickets",
    "mcp__chuggy__read_ticket",
    "mcp__chuggy__read_projects",
    "mcp__chuggy__read_lead",
    "mcp__chuggy__read_lead_transcript",
    "mcp__chuggy__read_operation",
    "mcp__chuggy__list_threads",
    "mcp__chuggy__read_thread",
    "mcp__chuggy__read_thread_transcript",
    "mcp__chuggy__update_ticket",
    "mcp__chuggy__dispatch_ticket",
    "mcp__chuggy__revoke_ticket",
    "mcp__chuggy__resume_ticket",
  ],
  modelAllowlist: ["*"],
  operationalContextMaxAgeMs: 30000,
};

export const baselineSeed: readonly string[] = [
  `INSERT INTO public.execution_cluster VALUES ('default', 64, 1);`,
  `INSERT INTO installation_authority DEFAULT VALUES;`,
  `INSERT INTO public.selector_inventory_state VALUES (1, NULL, NULL);`,
  `INSERT INTO public.selector_runtime_readiness VALUES (1, false, now());`,
  `INSERT INTO public.selector_runtime_settings
     (singleton,revision,mode,dispatch_mode,base_prompt,controls,updated_at)
   VALUES (1, 1, 'Running', 'ApprovalRequired', 'Select at most one currently dispatchable ticket. Use the supplied project view and advisory operational context. Prefer work that unblocks other tickets, respect explicit urgency and dependencies, and wait when evidence or safe capacity is insufficient. Use only authorized selector tools and record the evidence used for the decision.',
     '${JSON.stringify(baselineControls)}', now());`,
  `INSERT INTO public.thread_wake_cursor VALUES (true, 0);`,
  `INSERT INTO selector_runtime_settings_history (revision,mode,dispatch_mode,base_prompt,controls,administrator_kind,administrator_subject) SELECT revision,mode,dispatch_mode,base_prompt,controls,'System','baseline' FROM selector_runtime_settings`,
];
