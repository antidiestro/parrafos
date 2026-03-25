import { AdminLoginForm } from "./login-form";

export default function AdminLoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-8 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Parrafos admin</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Sign in with the password configured in the environment.
        </p>
      </div>
      <AdminLoginForm />
    </main>
  );
}
