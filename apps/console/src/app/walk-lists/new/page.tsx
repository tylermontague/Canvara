import Link from "next/link";
import { WalkListBuilder } from "./builder";

export default function NewWalkListPage() {
  return (
    <div className="min-h-screen bg-zinc-950 p-6 text-zinc-100">
      <div className="mb-6">
        <Link href="/walk-lists" className="text-sm text-zinc-400 hover:text-zinc-200">
          ← Walk lists
        </Link>
        <h1 className="text-2xl font-semibold">New walk list</h1>
        <p className="text-sm text-zinc-400">
          Filter voters, pick who to include, assign a canvasser. Stops are ordered
          street-by-street automatically.
        </p>
      </div>
      <WalkListBuilder />
    </div>
  );
}
