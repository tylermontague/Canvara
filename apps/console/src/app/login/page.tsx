import Image from "next/image";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone p-6">
      <div className="w-full max-w-sm rounded-xl border border-rule bg-white p-8">
        <Image
          src="/brand/canvara-lockup-light.svg"
          alt="Canvara"
          width={160}
          height={40}
          className="mx-auto mb-6 h-10 w-auto"
          priority
        />
        <h1 className="mb-1 text-center font-serif text-2xl font-bold text-navy">
          Sign in
        </h1>
        <p className="mb-8 text-center text-sm text-slate">
          Campaign console — sign in with your campaign account.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
