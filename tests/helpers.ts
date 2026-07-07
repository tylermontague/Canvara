// Shared helpers for milestone exit tests.

import type { DbClient } from "@canvara/db";

export const CANVASSER_A = {
  email: "m1-canvasser-a@canvara-test.dev",
  password: "m1-test-canvasser-8k4p",
  fullName: "M1 Canvasser A",
};

/** Ensure the test canvasser auth user + profile exist in the campaign. */
export async function ensureCanvasser(
  service: DbClient,
  campaignId: string,
): Promise<string> {
  const { data: userList, error: listErr } = await service.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listErr) throw new Error(listErr.message);

  let userId = userList.users.find((u) => u.email === CANVASSER_A.email)?.id;
  if (!userId) {
    const { data: created, error: createErr } = await service.auth.admin.createUser({
      email: CANVASSER_A.email,
      password: CANVASSER_A.password,
      email_confirm: true,
    });
    if (createErr) throw new Error(createErr.message);
    userId = created.user.id;
  }

  const { data: profile } = await service
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) {
    const { error: profErr } = await service.from("profiles").insert({
      id: userId,
      campaign_id: campaignId,
      role: "canvasser",
      full_name: CANVASSER_A.fullName,
    });
    if (profErr) throw new Error(profErr.message);
  }
  return userId;
}
