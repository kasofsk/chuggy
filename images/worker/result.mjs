import { resultReportCharsMax } from "@chuggy/worker-contract/workerDocuments";

/** The account an agent is told to finish with, whose summary becomes the manifest's report. */
export const agentResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "summary"],
  properties: {
    verdict: { enum: ["Pass", "Fail"] },
    summary: { type: "string", minLength: 1, maxLength: resultReportCharsMax },
  },
};

export function agentResult(value, runtime) {
  if (value?.verdict !== "Pass" && value?.verdict !== "Fail")
    throw new Error(`${runtime} returned no structured verdict`);
  if (
    typeof value.summary !== "string" ||
    value.summary.length === 0 ||
    value.summary.length > resultReportCharsMax
  )
    throw new Error(`${runtime} returned no structured verdict`);
  return value;
}
