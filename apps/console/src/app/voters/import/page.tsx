import Link from "next/link";
import { ImportWizard } from "./import-wizard";

export default function ImportPage() {
  return (
    <div className="min-h-screen bg-zinc-950 p-6 text-zinc-100">
      <div className="mb-6">
        <Link href="/voters" className="text-sm text-zinc-400 hover:text-zinc-200">
          ← Voters
        </Link>
        <h1 className="text-2xl font-semibold">Import voter file</h1>
        <p className="text-sm text-zinc-400">
          Upload a CSV, confirm the header row, map columns to voter fields, import.
        </p>
      </div>
      <ImportWizard />
    </div>
  );
}
