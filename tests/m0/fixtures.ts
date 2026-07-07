// Shared fixtures for the M0 exit test (seed + isolation test).
// Test-only credentials — these users exist solely to prove RLS isolation.

export const CAMPAIGN_A = { name: "M0 Test Campaign A", state: "AZ" };
export const CAMPAIGN_B = { name: "M0 Test Campaign B", state: "NV" };

export const USER_A = {
  email: "m0-user-a@canvara-test.dev",
  password: "m0-test-password-a-7f3k",
  fullName: "M0 User A",
  role: "manager",
};

export const USER_B = {
  email: "m0-user-b@canvara-test.dev",
  password: "m0-test-password-b-9x2m",
  fullName: "M0 User B",
  role: "manager",
};
