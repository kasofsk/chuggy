export const agentResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "summary"],
  properties: {
    verdict: { enum: ["Pass", "Fail"] },
    summary: { type: "string", minLength: 1, maxLength: 8192 },
  },
};

export function agentResult(value, runtime) {
  if (value?.verdict !== "Pass" && value?.verdict !== "Fail")
    throw new Error(`${runtime} returned no structured verdict`);
  if (
    typeof value.summary !== "string" ||
    value.summary.length === 0 ||
    value.summary.length > 8192
  )
    throw new Error(`${runtime} returned no structured verdict`);
  return value;
}
