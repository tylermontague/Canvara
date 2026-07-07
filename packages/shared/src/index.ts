// @canvara/shared — SignalObject types, issue taxonomy, belief math, zod schemas.
// M0: role and tenancy primitives. SignalObject/zod schemas land with M3.

export const ROLES = [
  "admin",
  "manager",
  "field_director",
  "organizer",
  "canvasser",
] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export const CONSENT_MODES = ["one_party", "two_party"] as const;
export type ConsentMode = (typeof CONSENT_MODES)[number];

export * from "./voter-import.js";
