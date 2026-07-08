import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { SettingsForm } from "./settings-form";
import { SurveyQuestions } from "./survey-questions";

// Fixed pipeline status order — statuses with no rows are omitted.
const STATUS_ORDER = [
  "captured",
  "uploaded",
  "transcribing",
  "transcribed",
  "extracting",
  "extracted",
  "review",
  "complete",
  "failed",
] as const;

export default async function AdminPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const profile = user
    ? (
        await supabase
          .from("profiles")
          .select("role, campaign_id, campaigns(name, state)")
          .eq("id", user.id)
          .single()
      ).data
    : null;

  const campaignId = profile?.campaign_id ?? null;
  const canEdit = profile?.role === "admin" || profile?.role === "manager";

  const [campaign, pipelineHealth, reviewCount, auditRows, surveyQuestions] = await Promise.all([
    campaignId
      ? supabase
          .from("campaigns")
          .select("id, name, state, consent_mode, retention_days")
          .eq("id", campaignId)
          .single()
          .then((r) => r.data)
      : Promise.resolve(null),
    supabase
      .from("pipeline_health")
      .select("campaign_id, status, n, newest, oldest_in_flight")
      .then((r) => r.data ?? []),
    supabase
      .from("review_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "open")
      .then((r) => r.count ?? 0),
    supabase
      .from("audit_log")
      .select("id, actor_id, action, entity, entity_id, detail, created_at, profiles(full_name)")
      .order("created_at", { ascending: false })
      .limit(100)
      .then((r) => r.data ?? []),
    supabase
      .from("survey_questions")
      .select("id, question, options, kind, active, position")
      .order("position", { ascending: true })
      .then((r) => r.data ?? []),
  ]);

  const healthByStatus = new Map(pipelineHealth.map((row) => [row.status, row]));
  const orderedHealth = STATUS_ORDER.filter((status) => healthByStatus.has(status)).map(
    (status) => healthByStatus.get(status)!,
  );
  const totalConversations = pipelineHealth.reduce((sum, row) => sum + row.n, 0);

  return (
    <div className="flex min-h-screen flex-col bg-stone">
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 p-6">
        <div className="mb-6">
          <h1 className="font-serif text-2xl font-bold text-navy">Admin</h1>
          <p className="text-sm text-slate">
            Campaign settings, pipeline health, and the audit trail.
          </p>
        </div>

        {/* Campaign settings */}
        <section className="mb-6 rounded-xl border border-rule bg-white p-5">
          <h2 className="mb-3 font-serif text-lg font-bold text-navy">Campaign settings</h2>
          {campaign ? (
            <>
              <div className="mb-4 flex flex-wrap gap-x-8 gap-y-2">
                <div>
                  <p className="text-[11px] font-medium tracking-[0.08em] text-slate uppercase">
                    Name
                  </p>
                  <p className="text-sm text-ink">{campaign.name}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium tracking-[0.08em] text-slate uppercase">
                    State
                  </p>
                  <p className="text-sm text-ink">{campaign.state}</p>
                </div>
              </div>
              <SettingsForm
                campaignId={campaign.id}
                retentionDays={campaign.retention_days}
                consentMode={campaign.consent_mode}
                canEdit={canEdit}
              />
            </>
          ) : (
            <p className="text-sm text-slate">No campaign found for this account.</p>
          )}
        </section>

        {/* Door poll questions */}
        <section className="mb-6 rounded-xl border border-rule bg-white p-5">
          <h2 className="mb-3 font-serif text-lg font-bold text-navy">Door poll questions</h2>
          {campaignId ? (
            <SurveyQuestions
              questions={surveyQuestions}
              campaignId={campaignId}
              canEdit={canEdit}
            />
          ) : (
            <p className="text-sm text-slate">No campaign found for this account.</p>
          )}
        </section>

        {/* Pipeline health */}
        <section className="mb-6 rounded-xl border border-rule bg-white p-5">
          <h2 className="mb-1 font-serif text-lg font-bold text-navy">Pipeline health</h2>
          <p className="mb-3 text-sm text-slate">
            {totalConversations.toLocaleString()} conversation
            {totalConversations === 1 ? "" : "s"} · {reviewCount} open review item
            {reviewCount === 1 ? "" : "s"}
          </p>
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr>
                {["Status", "Count", "Newest"].map((h) => (
                  <th
                    key={h}
                    className="border-b border-rule px-2 py-2 text-[11px] font-medium tracking-[0.08em] text-slate uppercase"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orderedHealth.map((row) => (
                <tr key={row.status} className="border-t border-rule">
                  <td className="px-2 py-2 text-ink">{row.status}</td>
                  <td
                    className={`px-2 py-2 font-mono ${
                      row.status === "failed" && row.n > 0 ? "text-red-600" : "text-ink"
                    }`}
                  >
                    {row.n}
                  </td>
                  <td className="px-2 py-2 text-slate">
                    {row.newest ? new Date(row.newest).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
              {orderedHealth.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-2 py-8 text-center text-slate">
                    No conversations yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {/* Audit trail */}
        <section className="rounded-xl border border-rule bg-white p-5">
          <h2 className="mb-3 font-serif text-lg font-bold text-navy">Audit trail</h2>
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr>
                {["Time", "Actor", "Action", "Entity"].map((h) => (
                  <th
                    key={h}
                    className="border-b border-rule px-2 py-2 text-[11px] font-medium tracking-[0.08em] text-slate uppercase"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {auditRows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-rule"
                  title={JSON.stringify(row.detail)}
                >
                  <td className="px-2 py-2 whitespace-nowrap text-slate">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="px-2 py-2">
                    {row.actor_id ? (
                      <span className="text-slate">
                        {row.profiles?.full_name ?? "—"}
                      </span>
                    ) : (
                      <span className="text-slate italic">system</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-ink">{row.action.replace(/_/g, " ")}</td>
                  <td className="px-2 py-2 font-mono text-xs text-slate">
                    {row.entity}
                    {row.entity_id ? ` · ${row.entity_id.slice(0, 8)}` : ""}
                  </td>
                </tr>
              ))}
              {auditRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-2 py-8 text-center text-slate">
                    No audit events yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}
