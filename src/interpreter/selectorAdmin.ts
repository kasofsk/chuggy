import type { Principal } from "./nativeWeb.ts";
import type {
  SelectorPolicyControls,
  SelectorRuntimeControlStore,
  SelectorRuntimeSettings,
  SelectorSettingsUpdate,
} from "./selector.ts";

export interface SelectorAdministrationAccess {
  authorize(
    principal: Principal,
    capability: "ManageSelector",
  ): Promise<boolean>;
}

export interface SelectorRuntimeAdministration {
  pause(
    principal: Principal,
    expectedRevision: number,
  ): Promise<SelectorSettingsUpdate>;
  unpause(
    principal: Principal,
    expectedRevision: number,
  ): Promise<SelectorSettingsUpdate>;
  setDispatchMode(
    principal: Principal,
    expectedRevision: number,
    mode: SelectorRuntimeSettings["dispatchMode"],
  ): Promise<SelectorSettingsUpdate>;
  updateBasePrompt(
    principal: Principal,
    expectedRevision: number,
    prompt: string,
  ): Promise<SelectorSettingsUpdate>;
  updatePolicyControls(
    principal: Principal,
    expectedRevision: number,
    controls: SelectorPolicyControls,
  ): Promise<SelectorSettingsUpdate>;
  rollback(
    principal: Principal,
    expectedRevision: number,
    targetRevision: number,
  ): Promise<SelectorSettingsUpdate>;
}

export function selectorRuntimeAdministration(
  access: SelectorAdministrationAccess,
  store: SelectorRuntimeControlStore,
): SelectorRuntimeAdministration {
  const authorized = async <T>(
    principal: Principal,
    change: () => Promise<T>,
  ): Promise<T> => {
    if (!(await access.authorize(principal, "ManageSelector")))
      throw new Error("selector administration is forbidden");
    return change();
  };
  return {
    pause: (principal, revision) =>
      authorized(principal, () => store.pause(revision)),
    unpause: (principal, revision) =>
      authorized(principal, () => store.unpause(revision)),
    setDispatchMode: (principal, revision, mode) =>
      authorized(principal, () => store.setDispatchMode(revision, mode)),
    updateBasePrompt: (principal, revision, prompt) =>
      authorized(principal, () => store.updateBasePrompt(revision, prompt)),
    updatePolicyControls: (principal, revision, controls) =>
      authorized(principal, () =>
        store.updatePolicyControls(revision, controls),
      ),
    rollback: (principal, revision, target) =>
      authorized(principal, () => store.rollback(revision, target)),
  };
}
