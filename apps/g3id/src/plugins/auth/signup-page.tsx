import { useTeamNames } from "@g3/ui";
import { FaSlack } from "react-icons/fa";
import { Link } from "react-router-dom";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";

export function SignupPage() {
  const names = useTeamNames();
  return (
    <main className="flex-1 flex items-center justify-center px-4 bg-secondary-50">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-5xl font-bold text-secondary-900">
            Join <span className="text-primary-500">{names.shortName}</span>ID
          </h1>
          <p className="mt-2 text-secondary-700 text-sm">
            {names.idName} uses Slack for signup. Once you signup, you can add additional login
            methods.
          </p>
        </div>

        <a
          href={`${apiBase}/auth/slack/initiate`}
          className="w-full flex items-center justify-center gap-3 rounded-lg bg-primary-500 hover:bg-primary-600 px-4 py-3 text-sm text-white font-medium transition-colors"
        >
          <FaSlack size={20} />
          Sign up with Slack
        </a>

        <p className="text-center text-sm text-secondary-500">
          Already have an account?{" "}
          <Link to="/login" className="text-primary-500 hover:text-primary-600 transition-colors">
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
