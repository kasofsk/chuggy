import { accountIdentityFunction, apiRole, type Migration } from "../shared.ts";

export const migration017: Migration = {
  version: 17,
  name: "selector context account read",
  statements: [
    `GRANT EXECUTE ON FUNCTION ${accountIdentityFunction}(text,text) TO ${apiRole}`,
  ],
};
