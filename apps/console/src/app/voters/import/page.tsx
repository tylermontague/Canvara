import { AppHeader } from "@/components/app-header";
import { ImportWizard } from "./import-wizard";

export default function ImportPage() {
  return (
    <div className="flex min-h-screen flex-col bg-stone">
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 p-6">
        <div className="mb-6">
          <h1 className="font-serif text-2xl font-bold text-navy">Import voter file</h1>
          <p className="text-sm text-slate">
            Upload a CSV, confirm the header row, map columns to voter fields, import.
          </p>
        </div>
        <ImportWizard />
      </main>
    </div>
  );
}
