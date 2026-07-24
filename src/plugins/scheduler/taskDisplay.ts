export type TaskOriginKind = "system" | "user" | "skill";

// Anything that is not "system"/"user" renders as a skill task — new origins
// added server-side degrade to the skill badge instead of an empty chip.
export const originKind = (origin: string): TaskOriginKind => {
  if (origin === "system") return "system";
  if (origin === "user") return "user";
  return "skill";
};

export type ResultDotKind = "success" | "error" | "other";

export const resultDotKind = (result: string): ResultDotKind => {
  if (result === "success") return "success";
  if (result === "error") return "error";
  return "other";
};

// `enabled: undefined` means enabled, so the next state is NOT `!current`:
// an undefined (enabled) task must toggle to disabled, exactly like `true`.
export const nextEnabledState = (current: boolean | undefined): boolean => current === false;
