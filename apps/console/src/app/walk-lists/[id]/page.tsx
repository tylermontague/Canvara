import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
    <div className="min-h-screen bg-zinc-950 p-6 text-zinc-100">
      <div className="mb-6">
        <Link href="/walk-lists" className="text-sm text-zinc-400 hover:text-zinc-200">
          ← Walk lists
        </Link>
        <h1 className="text-2xl font-semibold">{list.name}</h1>
        <p className="text-sm text-zinc-400">
          {items?.length ?? 0} stops · assigned to{" "}
          {list.profiles?.full_name ?? "no one yet"} · created{" "}
          {new Date(list.created_at).toLocaleDateString()}
        </p>
      </div>
      <StopList items={items ?? []} />
    </div>
  );
}
