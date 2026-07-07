import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold text-zinc-50">Canvara</h1>
        <p className="mb-8 text-sm text-zinc-400">
          Campaign console — sign in with your campaign account.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
