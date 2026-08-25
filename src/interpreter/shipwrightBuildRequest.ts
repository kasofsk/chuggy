/** Deterministic build declarations accepted by the Chuggy fabric. */

import type { GitObjectId } from "./finalizer.ts";
import type { HandoffDigestFunction } from "./handoffConfiguration.ts";

export const shipwrightBuildRequestRenderer = "shipwright-build-request/v1";
export const shipwrightBuildRequestProfile = {
  name: "shipwright-buildkit-rootless-mini/v1",
  digest:
    "sha256:b4d3bb9e36544a6bb1b51bdda3021fd628cb343960d2f0139a3cf1bb5fe5f0c5",
} as const;

export interface ShipwrightBuildRequestInput {
  readonly repositoryId: string;
  readonly sourceUrl: string;
  readonly sourceCommit: GitObjectId;
  readonly sourceCredentialReference: string;
  readonly contextDirectory: string;
  readonly dockerfile: string;
  readonly targetImageRepository: string;
  readonly outputCredentialReference: string;
}

export interface RenderedBuildRequest {
  readonly path: string;
  readonly content: string;
  readonly digest: string;
}

interface CanonicalBuildRequest {
  readonly cache: "registry";
  readonly output: {
    readonly credentialRef: string;
    readonly credentialRole: "registry-push";
    readonly repository: string;
  };
  readonly platforms: readonly ["linux/amd64"];
  readonly profile: typeof shipwrightBuildRequestProfile;
  readonly renderer: typeof shipwrightBuildRequestRenderer;
  readonly source: {
    readonly commit: GitObjectId;
    readonly contextDir: string;
    readonly credentialRef: string;
    readonly credentialRole: "source-read";
    readonly dockerfile: string;
    readonly repositoryId: string;
    readonly url: string;
  };
}

function buildRequestCanonical(
  input: ShipwrightBuildRequestInput,
): CanonicalBuildRequest {
  return {
    cache: "registry",
    output: {
      credentialRef: input.outputCredentialReference,
      credentialRole: "registry-push",
      repository: input.targetImageRepository,
    },
    platforms: ["linux/amd64"],
    profile: shipwrightBuildRequestProfile,
    renderer: shipwrightBuildRequestRenderer,
    source: {
      commit: input.sourceCommit,
      contextDir: input.contextDirectory,
      credentialRef: input.sourceCredentialReference,
      credentialRole: "source-read",
      dockerfile: input.dockerfile,
      repositoryId: input.repositoryId,
      url: input.sourceUrl,
    },
  };
}

function quoted(value: string): string {
  return JSON.stringify(value);
}

function buildRequestBuildManifest(
  request: CanonicalBuildRequest,
  digestHex: string,
): string {
  const name = `build-${digestHex.slice(0, 40)}`;
  const source = request.source;
  const output = request.output;
  const profile = request.profile;
  const image = `${output.repository}:request-${digestHex}`;
  return `apiVersion: shipwright.io/v1beta1
kind: Build
metadata:
  name: ${name}
  namespace: chuggy-build
  annotations:
    fabric.chuggy.dev/source-repository-id: ${source.repositoryId}
    fabric.chuggy.dev/request-digest: sha256:${digestHex}
    fabric.chuggy.dev/source-commit: ${source.commit}
    fabric.chuggy.dev/target-image-repository: ${quoted(output.repository)}
    fabric.chuggy.dev/renderer: ${shipwrightBuildRequestRenderer}
    fabric.chuggy.dev/profile: ${profile.name}
    fabric.chuggy.dev/profile-digest: ${profile.digest}
    fabric.chuggy.dev/shipwright-version: v0.18.4
spec:
  source:
    type: Git
    git:
      url: ${quoted(source.url)}
      revision: ${source.commit}
    contextDir: ${quoted(source.contextDir)}
    credentials:
      name: ${source.credentialRef}
  strategy:
    kind: ClusterBuildStrategy
    name: buildkit-rootless-v1
  paramValues:
    - name: dockerfile
      value: ${quoted(source.dockerfile)}
    - name: cache
      value: registry
  output:
    image: ${quoted(image)}
    credentials:
      name: ${output.credentialRef}
  timeout: 1h
`;
}

function buildRequestRunManifest(
  request: CanonicalBuildRequest,
  digestHex: string,
): string {
  const name = `build-${digestHex.slice(0, 40)}`;
  const attempt = `${name}-a1`;
  const source = request.source;
  const output = request.output;
  const profile = request.profile;
  return `apiVersion: shipwright.io/v1beta1
kind: BuildRun
metadata:
  name: ${attempt}
  namespace: chuggy-build
  labels:
    fabric.chuggy.dev/provenance: required
  annotations:
    fabric.chuggy.dev/source-repository-id: ${source.repositoryId}
    fabric.chuggy.dev/request-digest: sha256:${digestHex}
    fabric.chuggy.dev/source-commit: ${source.commit}
    fabric.chuggy.dev/target-image-repository: ${quoted(output.repository)}
    fabric.chuggy.dev/renderer: ${shipwrightBuildRequestRenderer}
    fabric.chuggy.dev/profile: ${profile.name}
    fabric.chuggy.dev/profile-digest: ${profile.digest}
    fabric.chuggy.dev/shipwright-version: v0.18.4
    fabric.chuggy.dev/attempt-ordinal: "1"
  finalizers:
    - fabric.chuggy.dev/provenance-required
spec:
  build:
    name: ${name}
  serviceAccount:
    name: builder
  nodeSelector:
    chuggy.dev/node-role: builder
    kubernetes.io/os: linux
    kubernetes.io/arch: amd64
`;
}

function buildRequestManifest(
  request: CanonicalBuildRequest,
  digestHex: string,
): string {
  return `${buildRequestBuildManifest(request, digestHex)}---
${buildRequestRunManifest(request, digestHex)}`;
}

/** Renders one immutable fabric build request from a pinned source commit. */
export function renderShipwrightBuildRequest(
  input: ShipwrightBuildRequestInput,
  digestOf: HandoffDigestFunction,
): RenderedBuildRequest {
  const canonical = JSON.stringify(buildRequestCanonical(input));
  const digestHex = digestOf(canonical);
  const digest = `sha256:${digestHex}`;
  return {
    path: `builds/${input.repositoryId}/${input.sourceCommit}/${digestHex}.yaml`,
    content: buildRequestManifest(buildRequestCanonical(input), digestHex),
    digest,
  };
}
