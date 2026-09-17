import type { RepositoryBinding, RepositoryId } from "./finalizer.ts";
import type { Partition } from "./projectStore.ts";

export interface ProjectRepositoryBindingRead {
  /**
   * The binding of the repository named, or of the project's oldest where a
   * caller names none — which is what a caller holding no ticket to take one
   * from still asks for.
   */
  binding(
    partition: Partition,
    repository?: RepositoryId,
  ): Promise<RepositoryBinding | undefined>;
}

export const repositoryBindingsPerImportMax = 1_000;

export interface RepositoryBindingListed {
  readonly partition: Partition;
  readonly repository: RepositoryId;
  readonly boundAt: string;
}

export interface RepositoryBindingListing {
  bindings(max: number): Promise<readonly RepositoryBindingListed[]>;
}
