/** One version 1 configuration as a repository declares it, which every import reads as ready. */

import type { RepositoryDeclarationFile } from "../../src/contract/repositoryDeclaration.ts";
import { repositoryDeclarationRoot } from "../../src/contract/repositoryDeclaration.ts";

export const repositoryConfigurationWorkFile: RepositoryDeclarationFile = {
  path: `${repositoryDeclarationRoot}configurations/work.json`,
  kind: "File",
  content: JSON.stringify({
    version: 1,
    name: "work",
    configuration: {
      version: 1,
      image: "worker:v1",
      practices: [],
      brief: {
        motivation: ["Do the work."],
        acceptanceCriteria: ["The work is done."],
        constraints: [],
      },
      work: { instructions: [] },
      review: { instructions: [] },
      worker: {
        mode: { type: "SingleAgent", agent: "Claude", arguments: [] },
        setup: [],
        files: [],
      },
    },
  }),
};
