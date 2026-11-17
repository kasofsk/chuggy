/**
 * What a run of `configuration`, `check` or `import` came to, as the report
 * holds it: values alone, so the report reaches none of the reading and
 * writing `ui/chuggy-ui/app/core/setupConfiguration.ts` does.
 */

import type { Copy } from "./copy.ts";

/** What the starting configuration leaves for the person and their agent to fill in. */
export type SetupBlank = "Image" | "Test";

/** How a run of `configuration` ended: the file written and what it leaves blank, the declarations already there and left as they are, or no checkout to write in. */
export type SetupConfigurationEnded =
  | {
      readonly ended: "Written";
      readonly path: string;
      /** Each field left blank, by what it is and the field `check` names it as. */
      readonly blanks: readonly {
        readonly blank: SetupBlank;
        readonly field: string;
      }[];
    }
  | { readonly ended: "Kept"; readonly paths: readonly string[] }
  | { readonly ended: "Outside" };

/** One fault `check` found: the file, the fault in the console's words and the configuration's own where it names one, and the fields it is about. */
export interface SetupCheckFault {
  readonly path: string;
  readonly fault: Copy;
  readonly detail: string | undefined;
  readonly fields: readonly string[];
}

/** How a run of `check` ended: every declaration ready, the faults that refuse the directory and how many there are, a directory declaring nothing, or no checkout to read. */
export type SetupCheckEnded =
  | { readonly ended: "Clean"; readonly paths: readonly string[] }
  | {
      readonly ended: "Refused";
      readonly faults: readonly SetupCheckFault[];
      readonly count: number;
    }
  | { readonly ended: "Absent"; readonly directory: string }
  | { readonly ended: "Outside" };

/** What the site answered the import, as `import` says it: imported, or refused, in the words the repositories page says that refusal in, with each file it refused where it named them. */
export type SetupImportAnswered =
  | { readonly answered: "Imported" }
  | {
      readonly answered: "Refused";
      readonly refusal: Copy;
      readonly faults: readonly SetupCheckFault[];
    };
