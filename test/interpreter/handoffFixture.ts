/**
 * The handoff configuration every suite that needs a valid one starts from.
 *
 * It is shared rather than restated because three suites now need a document
 * that passes `authoredHandoffConfigurationReadiness`, and three copies of one
 * would drift apart the first time that readiness gains a field.
 */

/** The one valid handoff configuration, with whichever of its fields a case varies. */
export function handoffFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 1,
    mode: "DirectCommit",
    repositories: {
      work: {
        repository: "ledger-engine",
        targetRef: "refs/heads/release",
      },
      handoff: {
        repository: "platform-desires",
        targetRef: "refs/heads/team-orange",
      },
    },
    credentials: {
      work: "ledger-release-writer",
      handoff: "platform-request-writer",
    },
    renderer: {
      identity: "ContainerBuildRequest",
      version: 1,
      parameters: {
        targetImageRepository: "registry.example/ledger",
        builderProfile: "rootless-multiarch",
        platforms: ["linux/amd64", "linux/arm64"],
      },
    },
    destinationPath: "builds/ledger/request.json",
    outputBytesMax: 4096,
    ...overrides,
  };
}
