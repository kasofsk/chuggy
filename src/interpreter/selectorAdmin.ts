import type { Principal } from "./nativeWeb.ts";
import type { Authority } from "./operationInbox.ts";
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
  ): Promise<Authority | undefined>;
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
    change: (administrator: Authority) => Promise<T>,
  ): Promise<T> => {
    const administrator = await access.authorize(principal, "ManageSelector");
    if (administrator === undefined)
      throw new Error("selector administration is forbidden");
    return change(administrator);
  };
  return {
    pause: (principal, revision) =>
      authorized(principal, (administrator) =>
        store.pause(revision, administrator),
      ),
    unpause: (principal, revision) =>
      authorized(principal, (administrator) =>
        store.unpause(revision, administrator),
      ),
    setDispatchMode: (principal, revision, mode) =>
      authorized(principal, (administrator) =>
        store.setDispatchMode(revision, mode, administrator),
      ),
    updateBasePrompt: (principal, revision, prompt) =>
      authorized(principal, (administrator) =>
        store.updateBasePrompt(revision, prompt, administrator),
      ),
    updatePolicyControls: (principal, revision, controls) =>
      authorized(principal, (administrator) =>
        store.updatePolicyControls(revision, controls, administrator),
      ),
    rollback: (principal, revision, target) =>
      authorized(principal, (administrator) =>
        store.rollback(revision, target, administrator),
      ),
  };
}
