import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import type { Role } from "@canvara/shared";
import { GenerateForms } from "./generate-forms";
import { MessageActions } from "./message-actions";

const APPROVER_ROLES: Role[] = ["admin", "manager", "field_director"];

const GOAL_LABELS: Record<string, string> = {
  persuade: "Persuade",
  turnout: "Turnout",
  introduce: "Introduce",
};

const FLAG_LABELS: Record<string, string> = {
  alienation_risk: "alienation risk",
  partisan_tone: "partisan tone",
  overclaiming: "overclaiming",
  over_personalization: "over-personalization",
};

interface GuardrailShape {
  alienation_risk?: boolean;
  partisan_tone?: boolean;
  overclaiming?: boolean;
  over_personalization?: boolean;
  ceiling_note?: string;
  reasoning?: string;
}

function statusChipClasses(status: string): string {
  if (status === "approved") return "bg-green-50 text-green-800";
  if (status === "rejected") return "bg-red-50 text-red-700";
  return "bg-stone text-slate";
}

export default async function MessageLabPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let canApprove = false;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profile) {
      canApprove = APPROVER_ROLES.includes(profile.role as Role);
    }
  }

  const [{ data: cohorts }, { data: issues }, { data: messages }] = await Promise.all([
    supabase.from("cohorts").select("id, name").order("name", { ascending: true }),
    supabase.from("issues").select("id, label").order("label", { ascending: true }),
    supabase
      .from("messages")
      .select(
        "id, kind, goal, title, body, status, guardrail, guardrail_verdict, created_at, cohorts(name), voters(first_name, last_name)",
      )
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  return (
    <div className="flex min-h-screen flex-col bg-stone">
      <AppHeader />
      <main className="flex-1 p-6">
        <div className="mb-6">
          <h1 className="font-serif text-2xl font-bold text-navy">Message Lab</h1>
          <p className="text-sm text-slate">
            Messages are hypotheses tested against evidence. Drafted from cohort and personal
            intelligence, guardrail-checked, human-approved.
          </p>
        </div>

        <div className="mb-6">
          <GenerateForms
            cohorts={cohorts ?? []}
            issues={issues ?? []}
          />
        </div>

        <section>
          <h2 className="mb-3 font-serif text-lg font-bold text-navy">Drafts &amp; approved</h2>
          <div className="space-y-4">
            {(messages ?? []).map((message) => {
              const guardrail = (message.guardrail ?? {}) as GuardrailShape;
              const isFlagged = message.guardrail_verdict === "flag";
              const flags = (["alienation_risk", "partisan_tone", "overclaiming", "over_personalization"] as const).filter(
                (key) => guardrail[key] === true,
              );
              const target = message.cohorts?.name
                ? message.cohorts.name
                : message.voters
                  ? `${message.voters.first_name ?? ""} ${message.voters.last_name ?? ""}`.trim()
                  : "—";

              return (
                <div key={message.id} className="rounded-xl border border-rule bg-white p-5">
                  <h3 className="mb-2 font-serif text-lg font-bold text-navy">{message.title}</h3>
                  <p className="mb-3 leading-relaxed whitespace-pre-line text-ink">{message.body}</p>

                  <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate">
                    <span className="uppercase tracking-[0.08em]">{message.kind}</span>
                    <span>{target}</span>
                    <span>{GOAL_LABELS[message.goal] ?? message.goal}</span>
                    <span>{new Date(message.created_at).toLocaleDateString()}</span>
                  </div>

                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                        isFlagged ? "bg-red-50 text-red-700" : "bg-green-50 text-green-800"
                      }`}
                    >
                      {isFlagged ? "guardrail: FLAG" : "guardrail: pass"}
                    </span>
                    {isFlagged &&
                      flags.map((flag) => (
                        <span
                          key={flag}
                          className="rounded-md bg-red-50 px-2 py-0.5 text-xs text-red-700"
                        >
                          {FLAG_LABELS[flag]}
                        </span>
                      ))}
                    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${statusChipClasses(message.status)}`}>
                      {message.status}
                    </span>
                  </div>

                  {isFlagged && guardrail.reasoning && (
                    <p className="mb-2 text-sm text-slate italic">{guardrail.reasoning}</p>
                  )}
                  {guardrail.ceiling_note && (
                    <p className="mb-2 text-xs text-slate">Ceiling: {guardrail.ceiling_note}</p>
                  )}

                  {canApprove && message.status === "draft" && (
                    <MessageActions messageId={message.id} />
                  )}
                </div>
              );
            })}

            {(messages ?? []).length === 0 && (
              <p className="text-sm text-slate">No messages yet — draft one above.</p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
