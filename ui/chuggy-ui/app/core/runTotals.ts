export type RunRollupBasis = "List" | "Mixed";

export interface RunSpan {
  readonly from: string | undefined;
  readonly to: string | undefined;
}

export function runCountLabel(value: number): string {
  return Math.trunc(value).toLocaleString("en-US");
}
