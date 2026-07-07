import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { fetchIssueSalience } from "@canvara/shared";
import { CohortBuilder } from "./cohort-builder";

export default async function NewCohortPage() {
  const supabase = await createClient();
  const issues = await fetchIssueSalience(supabase);

  return (
    <div className="flex min-h-screen flex-col bg-stone">
      <AppHeader />
      <main className="flex-1 p-6">
        <div className="mb-6">
          <h1 className="font-serif text-2xl font-bold text-navy">New cohort</h1>
          <p className="text-sm text-slate">
            Define a standard demographic cohort, an issue-stance block, or both.
          </p>
        </div>

        <div className="max-w-2xl rounded-xl border border-rule bg-white p-5">
          <CohortBuilder issues={issues.map((i) => ({ issue: i.issue, mentions: i.mentions }))} />
        </div>
      </main>
    </div>
  );
}
