import { useNavigate } from "react-router-dom";

export function PendingPage() {
  const navigate = useNavigate();

  return (
    <main className="flex-1 flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <h1 className="text-3xl font-bold text-secondary-900">Account pending:</h1>
          <h1 className="text-3xl font-bold text-secondary-900">PLEASE READ THIS!</h1>
          <p className="mt-4 text-secondary-600 text-sm leading-relaxed space-y-3">
            <span className="block">
              Your account is awaiting admin approval. Once your account has been approved by an
              admin, you will receive a Slack message.
            </span>
            <span className="block">
              This may not happen immediately. You must then return to the login page and repeat the
              code sending process, this time to login rather than to sign up.
            </span>
          </p>
        </div>

        <button
          type="button"
          onClick={() => navigate("/login")}
          className="w-full rounded-lg bg-primary-500 hover:bg-primary-600 text-white font-semibold py-2.5 text-sm transition-colors"
        >
          I understand, take me to the login page
        </button>
      </div>
    </main>
  );
}
