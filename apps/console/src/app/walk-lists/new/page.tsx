import { AppHeader } from "@/components/app-header";
import { WalkListBuilder } from "./builder";

export default function NewWalkListPage() {
  return (
    <div className="flex min-h-screen flex-col bg-stone">
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 p-6">
        <div className="mb-6">
          <h1 className="font-serif text-2xl font-bold text-navy">New walk list</h1>
          <p className="text-sm text-slate">
            Filter voters, pick who to include, assign a canvasser. Stops are ordered
            street-by-street automatically.
          </p>
        </div>
        <WalkListBuilder />
      </main>
    </div>
  );
}
