import { buttonClass, useTeamNames } from "@g3/ui";
import { FaSlack } from "react-icons/fa";
import { Link } from "react-router-dom";
import { NotYourTeam } from "../../shared/not-your-team";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";

export function SignupPage() {
  const names = useTeamNames();
  return (
    <main className="flex-1 flex items-center justify-center px-4 bg-secondary-50">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-4xl text-secondary-900">Join {names.name}</h1>
          <p className="mt-2 text-secondary-700 text-sm">
            Sign up with Slack. You can add other sign-in methods afterward.
          </p>
        </div>

        <a href={`${apiBase}/auth/slack/initiate`} className={`${buttonClass()} w-full`}>
          <FaSlack size={20} />
          Sign up with Slack
        </a>

        <p className="text-center text-sm text-secondary-500">
          Already have an account?{" "}
          <Link to="/login" className="text-primary-500 hover:text-primary-600 transition-colors">
            Sign in
          </Link>
        </p>
        <NotYourTeam />
      </div>
    </main>
  );
}
