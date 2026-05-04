export type DestructiveNameAllowlistEntry = {
  command: string;
  justification: string;
  fixturePath: string;
};

export const SAFE_DESTRUCTIVE_NAME_ALLOWLIST: DestructiveNameAllowlistEntry[] = [];

export const SAFE_DESTRUCTIVE_NAME_ALLOWLIST_MAX_ENTRIES = 20;
