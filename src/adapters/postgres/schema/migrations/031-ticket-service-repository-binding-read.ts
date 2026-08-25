import {
  repositoryBindingReadFunction,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";

export const migration031: Migration = {
  version: 31,
  name: "ticket service repository binding read",
  statements: [
    `GRANT EXECUTE ON FUNCTION ${repositoryBindingReadFunction}(text,text)
       TO ${ticketServiceRole}`,
  ],
};
