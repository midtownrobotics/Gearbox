import { Button } from "@g3/ui";
import { useNavigate } from "react-router-dom";

export function PendingPage() {
  const navigate = useNavigate();

  return (
    <main className="flex-1 flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <h1 className="text-4xl text-secondary-900">Your account is waiting for approval</h1>
          <p className="mt-4 text-secondary-600 text-sm leading-relaxed space-y-3">
            <span className="block">
              Your account is waiting for a trusted student's approval. You'll get a Slack message
              when it's approved.
            </span>
            <span className="block">
              Then come back to the sign-in page and sign in with a new code.
            </span>
          </p>
        </div>

        <Button className="w-full" onClick={() => navigate("/login")}>
          Go to the sign-in page
        </Button>
      </div>
    </main>
  );
}
