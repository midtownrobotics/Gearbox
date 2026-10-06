import { Link, useSearchParams } from "react-router-dom";

export function OAuthErrorPage() {
  const [params] = useSearchParams();
  const error = params.get("error") ?? "Something went wrong during sign-in.";

  return (
    <main className="flex-1 flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <h1 className="text-3xl font-bold text-secondary-900">Sign-in failed</h1>
          <p className="mt-2 text-secondary-600 text-sm">{error}</p>
        </div>

        <Link
          to="/login"
          className="block text-sm text-primary-500 hover:text-primary-600 transition-colors"
        >
          ← Back to sign in
        </Link>
      </div>
    </main>
  );
}
