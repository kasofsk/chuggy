import { apiRole, type Migration } from "../shared.ts";

export const migration030: Migration = {
  version: 30,
  name: "api dispatch view cursor read",
  statements: [
    `GRANT SELECT (notification_next) ON project TO ${apiRole}`,
    `GRANT SELECT (epoch,ordinal) ON recovery_epoch TO ${apiRole}`,
  ],
};
