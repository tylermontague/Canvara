import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { StopList } from "./stop-list";

export default async function WalkListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: list } = await supabase
    .from("walk_lists")
    .select("id, name, created_at, profiles(full_name, role)")
    .eq("id", id)
    .maybeSingle();
  if (!list) notFound();

  const { data: items } = await supabase
    .from("walk_list_items")
    .select(
      "id, position, status, voters(first_name, last_name, address, city, zip, party)",
    )
    .eq("walk_list_id", id)
    .order("position", { ascending: true });

  return (
    <div className="flex min-h-screen flex-col bg-stone">
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 p-6">
        <div className="mb-6">
          <h1 className="font-serif text-2xl font-bold text-navy">{list.name}</h1>
          <p className="text-sm text-slate">
            {items?.length ?? 0} stops · assigned to{" "}
            {list.profiles?.full_name ?? "no one yet"} · created{" "}
            {new Date(list.created_at).toLocaleDateString()}
          </p>
        </div>
        <StopList items={items ?? []} />
      </main>
    </div>
  );
}
