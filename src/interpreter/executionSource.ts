import type {
  ObservedTarget,
  RepositoryId,
  TargetObserved,
} from "./finalizer.ts";
import type { Partition } from "./projectStore.ts";
import type { ResultManifestId } from "./resultManifest.ts";

export interface ExecutionSourceObservation {
  readonly repository: RepositoryId;
  readonly target: Pick<ObservedTarget, "commit"> &
    Partial<Pick<ObservedTarget, "ref">>;
  readonly manifests: readonly ResultManifestId[];
}

export interface ExecutionSourceObservationPort {
  observe(input: {
    readonly partition: Partition;
    readonly ticket: number;
    readonly kind: "Work" | "Evaluation";
    readonly configurationCanonical?: string;
    readonly repository?: RepositoryId;
    readonly ref?: ObservedTarget["ref"];
    readonly credentialReference?: string;
  }): Promise<
    | {
        readonly observed: "Source";
        readonly source: ExecutionSourceObservation;
      }
    | Exclude<TargetObserved, { readonly observed: "Target" }>
  >;
}
