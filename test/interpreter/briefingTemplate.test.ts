/**
 * The authored template wording, held to the revision it says it is.
 *
 * WHAT THIS TIER CAN DECIDE about wording nothing derives is that it has not
 * moved silently. The case below digests every string the template states and
 * pins that digest beside `briefingTemplateVersion`, so an edit to any of them
 * fails here until the version moves with it and the pin is rewritten in the
 * same change. Without it the version is a number a reader has to trust, which
 * is the control that reports success and is never checked again.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  allTaskPurposes,
  briefingHeading,
  briefingLabels,
  briefingRequiredResult,
  briefingRoleInstructions,
  briefingSectionOrder,
  briefingTemplateSections,
  briefingTemplateVersion,
} from "../../src/interpreter/briefingTemplate.ts";

/** Every string the template states, in an order this file fixes rather than reads. */
function templateWording(): readonly string[] {
  const wording: string[] = [...briefingSectionOrder, ...briefingTemplateSections];
  for (const [label, text] of Object.entries(briefingLabels).sort()) {
    wording.push(label, text);
  }
  for (const purpose of allTaskPurposes) {
    wording.push(purpose);
    for (const section of briefingSectionOrder) {
      wording.push(briefingHeading(section, purpose));
    }
    wording.push(
      ...briefingRoleInstructions(purpose),
      ...briefingRequiredResult(purpose),
    );
  }
  return wording;
}

/** The wording as one value, length-prefixed so no string can spell out a boundary. */
function templateDigest(): string {
  const canonical = templateWording()
    .map((part) => `${String(part.length)}:${part}`)
    .join("");
  return createHash("sha256").update(canonical).digest("hex");
}

test("the template version moves with the wording it names", () => {
  assert.deepEqual(
    [briefingTemplateVersion, templateDigest()],
    [
      1,
      "c13bb3c0d94ef8d57db686756ec871958c4c3be005bc97f7feeed7e965f1cac8",
    ],
    "the template wording changed: move briefingTemplateVersion and repin this digest",
  );
});

test("the digest reads every string the template states", () => {
  const wording = templateWording();
  for (const purpose of allTaskPurposes) {
    for (const line of briefingRoleInstructions(purpose)) {
      assert.ok(wording.includes(line), `${line} is outside the pin`);
    }
    for (const line of briefingRequiredResult(purpose)) {
      assert.ok(wording.includes(line), `${line} is outside the pin`);
    }
    for (const section of briefingSectionOrder) {
      assert.ok(
        wording.includes(briefingHeading(section, purpose)),
        `${section} has a heading outside the pin`,
      );
    }
  }
  for (const text of Object.values(briefingLabels)) {
    assert.ok(wording.includes(text), `${text} is outside the pin`);
  }
});
