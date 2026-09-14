export const selectorSignatures: readonly (readonly [string, string])[] = [
  ["record_agentic_refusals", "text,text,text,jsonb,jsonb"],
  ["standing_agentic_refusals_among", "text,text,bigint[]"],
  ["lead_session", "text,text"],
  ["enqueue_lead_turn", "text,text,text,text"],
  ["read_lead_turn", "text"],
  ["withdraw_lead_turn", "text"],
];
export const interactionsReadSignature = "text,text,bigint,bigint,boolean";
export const systemPromptSetSignature = "text,text,text";
export const leadOpenSignature = "text,text,text,text,text,text";
