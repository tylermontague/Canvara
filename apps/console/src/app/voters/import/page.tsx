import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { ImportWizard } from "./import-wizard";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default async function ImportPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: imports } = await supabase
    .from("imports")
    .select("source_label, filename, inserted_count, updated_count, dropped_count, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <div className="flex min-h-screen flex-col bg-stone">
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 p-6">
        <div className="mb-6">
          <h1 className="font-serif text-2xl font-bold text-navy">Import voter file</h1>
          <p className="text-sm text-slate">
            Upload an Excel or CSV/text file to add or update voters. Re-importing never loses
            canvassing data — it merges.
          </p>
        </div>
        <ImportWizard />

        <section className="mt-10">
          <h2 className="mb-3 font-serif text-lg font-bold text-navy">Recent imports</h2>
          {imports && imports.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-rule bg-white">
              <table className="w-full text-sm">
                <thead className="text-left">
                  <tr>
                    {["Source", "When", "+ new", "~ updated", "− moved out"].map((h) => (
                      <th
                        key={h}
                        className="border-b border-rule px-3 py-2 text-[11px] font-medium tracking-[0.08em] text-slate uppercase"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {imports.map((imp, i) => (
                    <tr key={i} className="border-t border-rule">
                      <td className="px-3 py-1.5 text-ink">
                        {imp.source_label}
                        {imp.filename && imp.filename !== imp.source_label ? (
                          <span className="text-slate"> ({imp.filename})</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-1.5 text-slate">{fmtDate(imp.created_at)}</td>
                      <td className="px-3 py-1.5 font-mono text-ink">{imp.inserted_count}</td>
                      <td className="px-3 py-1.5 font-mono text-ink">{imp.updated_count}</td>
                      <td className="px-3 py-1.5 font-mono text-ink">{imp.dropped_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate">No imports yet.</p>
          )}
        </section>
      </main>
    </div>
  );
}
