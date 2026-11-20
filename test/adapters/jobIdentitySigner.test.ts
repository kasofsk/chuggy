import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from "jose";

import {
  jobIdentityKeyBitsMin,
  jobIdentitySigner,
} from "../../src/adapters/crypto/jobIdentitySigner.ts";
import type { JobIdentitySigner } from "../../src/interpreter/jobIdentityToken.ts";

function rsaPem(modulusLength: number): string {
  return generateKeyPairSync("rsa", { modulusLength })
    .privateKey.export({ format: "pem", type: "pkcs8" })
    .toString();
}

const firstPem = rsaPem(jobIdentityKeyBitsMin);
const secondPem = rsaPem(jobIdentityKeyBitsMin);

const claims = {
  iss: "https://issuer.example/acme",
  sub: "project:widgets:workload:build:task:work",
  aud: "audience",
  iat: 1_800_000_000,
  exp: 1_800_003_600,
};

async function built(pems: readonly string[]): Promise<JobIdentitySigner> {
  const answer = await jobIdentitySigner(pems);
  assert.equal(answer.result, "Built");
  return answer.signer;
}

async function refusal(pems: readonly string[]): Promise<unknown> {
  const answer = await jobIdentitySigner(pems);
  assert.equal(answer.result, "Refused");
  return answer.refusal;
}

async function verified(signer: JobIdentitySigner, token: string) {
  return jwtVerify(
    token,
    createLocalJWKSet({ keys: [...signer.keySet().keys] }),
    {
      algorithms: ["RS256"],
      currentDate: new Date((claims.iat + 1) * 1000),
    },
  );
}

test("a signed token verifies against the signer's own key set, selected by its kid", async () => {
  const signer = await built([firstPem]);
  const token = await signer.sign(claims);
  const { payload, protectedHeader } = await verified(signer, token);
  assert.deepEqual(payload, claims);
  const [published] = signer.keySet().keys;
  assert.deepEqual(protectedHeader, {
    alg: "RS256",
    typ: "JWT",
    kid: published?.kid,
  });
});

test("the first key signs and every key is published", async () => {
  const signer = await built([firstPem, secondPem]);
  const [first, second] = (await built([firstPem]))
    .keySet()
    .keys.concat((await built([secondPem])).keySet().keys);
  assert.deepEqual(signer.keySet().keys, [first, second]);
  const token = await signer.sign(claims);
  assert.equal(decodeProtectedHeader(token).kid, first?.kid);
  await verified(signer, token);
});

test("swapping the keys' order changes the signing kid and nothing else", async () => {
  const forward = await built([firstPem, secondPem]);
  const swapped = await built([secondPem, firstPem]);
  const byKid = (signer: JobIdentitySigner) =>
    [...signer.keySet().keys].sort((a, b) => a.kid.localeCompare(b.kid));
  assert.deepEqual(byKid(forward), byKid(swapped));
  const forwardToken = await forward.sign(claims);
  const swappedToken = await swapped.sign(claims);
  const forwardHeader = decodeProtectedHeader(forwardToken);
  const swappedHeader = decodeProtectedHeader(swappedToken);
  assert.notEqual(forwardHeader.kid, swappedHeader.kid);
  assert.deepEqual(
    { ...forwardHeader, kid: undefined },
    { ...swappedHeader, kid: undefined },
  );
  assert.deepEqual(
    (await verified(forward, swappedToken)).payload,
    (await verified(swapped, forwardToken)).payload,
  );
});

test("a kid is the key's RFC 7638 thumbprint, the same however often the key is read", async () => {
  const once = (await built([firstPem])).keySet().keys[0];
  const again = (await built([firstPem])).keySet().keys[0];
  assert.equal(once?.kid, again?.kid);
  assert.match(once?.kid ?? "", /^[A-Za-z0-9_-]{43}$/u);
});

test("the key set publishes public members only", async () => {
  const signer = await built([firstPem, secondPem]);
  for (const key of signer.keySet().keys) {
    assert.deepEqual(Object.keys(key).sort(), [
      "alg",
      "e",
      "kid",
      "kty",
      "n",
      "use",
    ]);
    assert.equal(key.alg, "RS256");
    assert.equal(key.use, "sig");
    for (const member of ["d", "p", "q", "dp", "dq", "qi"])
      assert.ok(!Object.hasOwn(key, member), member);
  }
});

test("an empty list is refused", async () => {
  assert.deepEqual(await refusal([]), { reason: "KeysEmpty" });
});

test("a key that is not RSA is refused, naming its place", async () => {
  const ecPem = generateKeyPairSync("ec", { namedCurve: "P-256" })
    .privateKey.export({ format: "pem", type: "pkcs8" })
    .toString();
  assert.deepEqual(await refusal([firstPem, ecPem]), {
    reason: "KeyNotRsa",
    key: 1,
  });
});

test("an RSA key under the minimum modulus is refused", async () => {
  assert.deepEqual(await refusal([rsaPem(jobIdentityKeyBitsMin - 1024)]), {
    reason: "KeyTooShort",
    key: 0,
  });
});

test("two keys with one thumbprint are refused, whatever their encoding", async () => {
  const pkcs1 = generateKeyPairSync("rsa", {
    modulusLength: jobIdentityKeyBitsMin,
  }).privateKey;
  const asPkcs8 = pkcs1.export({ format: "pem", type: "pkcs8" }).toString();
  const asPkcs1 = pkcs1.export({ format: "pem", type: "pkcs1" }).toString();
  assert.deepEqual(await refusal([asPkcs8, asPkcs1]), {
    reason: "KeyDuplicated",
    key: 1,
  });
});

test("text that is no private key is refused", async () => {
  assert.deepEqual(await refusal(["not a key"]), {
    reason: "KeyUnreadable",
    key: 0,
  });
});
