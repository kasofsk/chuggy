/**
 * The connector decisions with no renderer: each kind's fields and which the
 * contract requires, the write a draft sends, the faults found before it is
 * sent, and where each refusal the API answers is said.
 */

import { expect, test } from "vitest";

import { connectorKinds } from "../../../../src/contract/connectors.ts";
import {
  connectorLimitReachedCode,
  connectorStaleCode,
} from "../../../../src/contract/connectorAdministration.ts";
import {
  connectorDraftBlank,
  connectorDraftFaults,
  connectorDraftOf,
  connectorFieldsOf,
  connectorRemovalGone,
  connectorRemovalRefusal,
  connectorSettingsShown,
  connectorWriteOf,
  connectorWriteRefusal,
  connectorWriteRefusedLine,
} from "../../app/core/connectors.ts";
import {
  connectorInvalidNameBody,
  connectorInvalidSettingsBody,
} from "./connectorRefusalFixture.ts";

test("each kind lists its settings, required as the contract's schema requires them", () => {
  expect(
    Object.fromEntries(
      connectorKinds.map((kind) => [
        kind,
        connectorFieldsOf(kind).map(
          ({ setting, required, field }) =>
            `${setting}${required ? "" : "?"}:${field.control}`,
        ),
      ]),
    ),
  ).toStrictEqual({
    Aws: ["roleArn:Text", "sessionTags?:Switch"],
    Gcp: [
      "projectNumber:Text",
      "pool:Text",
      "provider:Text",
      "serviceAccount?:Text",
    ],
    Azure: ["tenantId:Text", "clientId:Text"],
    Anthropic: [
      "organizationId:Text",
      "federationRuleId:Text",
      "serviceAccountId?:Text",
      "workspaceId?:Text",
    ],
  });
});

test("a draft writes its own kind's settings trimmed, a blank left out and a switch only where on", () => {
  const draft = {
    ...connectorDraftBlank,
    name: " deploy ",
    texts: { roleArn: " arn:aws:iam::1:role/r ", pool: "left from Gcp" },
    switches: { sessionTags: false },
  };
  expect(connectorWriteOf(draft)).toStrictEqual({
    kind: "Aws",
    settings: { roleArn: "arn:aws:iam::1:role/r" },
  });
  expect(
    connectorWriteOf({ ...draft, switches: { sessionTags: true } }),
  ).toStrictEqual({
    kind: "Aws",
    settings: { roleArn: "arn:aws:iam::1:role/r", sessionTags: true },
  });
  expect(connectorWriteOf({ ...draft, kind: "Gcp" })).toBeUndefined();
  expect(connectorWriteOf({ ...draft, name: "Deploy" })).toBeUndefined();
});

test("a change starts from what stands and is written against its revision", () => {
  const draft = connectorDraftOf({
    name: "deploy",
    revision: 3,
    kind: "Aws",
    settings: { roleArn: "arn:aws:iam::1:role/r", sessionTags: true },
  });
  expect(connectorWriteOf(draft)).toStrictEqual({
    kind: "Aws",
    settings: { roleArn: "arn:aws:iam::1:role/r", sessionTags: true },
    expectedRevision: 3,
  });
});

test("only what was typed is at fault, beside its own field", () => {
  expect(connectorDraftFaults(connectorDraftBlank)).toStrictEqual({
    name: undefined,
    settings: {},
    form: undefined,
  });
  const faults = connectorDraftFaults({
    ...connectorDraftBlank,
    name: "-deploy",
    kind: "Gcp",
    texts: { projectNumber: "12a", serviceAccount: "ci" },
  });
  expect(faults.name?.id).toBe("connectors-fault-name");
  expect(faults.settings).toStrictEqual({
    projectNumber: { id: "connectors-fault-project-number" },
    serviceAccount: { id: "connectors-fault-email" },
  });
});

const rejected = (body: unknown) =>
  ({
    outcome: "Rejected",
    code: "InvalidRequest",
    status: 400,
    body,
  }) as const;

test("each refused write is said beside the field it concerns, from the body the API answers", () => {
  expect(
    connectorWriteRefusal(
      {
        outcome: "Conflict",
        code: connectorStaleCode,
        body: {
          error: { code: connectorStaleCode, message: "stale" },
          standing: 4,
        },
      },
      "Aws",
    ),
  ).toStrictEqual({ refusal: "Stale", standing: 4 });
  const limit = {
    outcome: "Conflict",
    code: connectorLimitReachedCode,
    body: { error: { code: connectorLimitReachedCode, message: "full" } },
  } as const;
  expect(connectorWriteRefusal(limit, "Aws")).toStrictEqual({
    refusal: "Faults",
    faults: {
      name: { id: "connectors-refused-limit", args: { count: 32 } },
      settings: {},
      form: undefined,
    },
  });
  expect(connectorWriteRefusedLine(limit)).toStrictEqual({
    id: "connectors-refused-fields",
  });
  const name = connectorWriteRefusal(
    rejected(connectorInvalidNameBody("-deploy")),
    "Aws",
  );
  expect(name.refusal === "Faults" ? name.faults.name?.id : name).toBe(
    "connectors-fault-name",
  );
  expect(
    connectorWriteRefusal(
      rejected(
        connectorInvalidSettingsBody({
          kind: "Gcp",
          settings: { projectNumber: "x", pool: "p", provider: "q" },
        }),
      ),
      "Gcp",
    ),
  ).toStrictEqual({
    refusal: "Faults",
    faults: {
      name: undefined,
      settings: { projectNumber: { id: "connectors-fault-project-number" } },
      form: undefined,
    },
  });
  expect(
    connectorWriteRefusal(
      rejected({ error: { code: "InvalidRequest", message: "kind: bad" } }),
      "Aws",
    ),
  ).toStrictEqual({
    refusal: "Faults",
    faults: {
      name: undefined,
      settings: {},
      form: { id: "connectors-refused-shape" },
    },
  });
});

test("a removal of what is already gone is nothing to say, and one the connector moved under says so", () => {
  expect(connectorRemovalGone({ outcome: "Absent" })).toBe(true);
  expect(
    connectorRemovalRefusal({
      outcome: "Conflict",
      code: connectorStaleCode,
      body: {},
    }),
  ).toStrictEqual({ id: "connectors-refused-stale" });
});

test("a list draws a switch as On or Off and a blank optional setting as not set", () => {
  expect(
    connectorSettingsShown({
      kind: "Aws",
      settings: { roleArn: "arn:aws:iam::1:role/r" },
    }).map((shown) => shown.value),
  ).toStrictEqual(["arn:aws:iam::1:role/r", { id: "connectors-switch-off" }]);
  expect(
    connectorSettingsShown({
      kind: "Gcp",
      settings: { projectNumber: "1", pool: "p", provider: "q" },
    }).at(-1)?.value,
  ).toBeUndefined();
});
