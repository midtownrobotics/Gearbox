import { NotYourTeam, buttonClass, chatName, useTeamChat, useTeamNames } from "@g3/ui";
import { FaDiscord, FaSlack } from "react-icons/fa";
import { Link } from "react-router-dom";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";

export function SignupPage() {
  const names = useTeamNames();
  // A team on Discord signs its members up with Discord; any other, with Slack.
  const chat = useTeamChat();
  const Icon = chat === "discord" ? FaDiscord : FaSlack;
  const start = chat === "discord" ? "/auth/discord" : "/auth/slack/initiate";
  return (
    <main className="flex-1 flex items-center justify-center px-4 bg-secondary-50">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-4xl text-secondary-900">Join {names.name}</h1>
          <p className="mt-2 text-secondary-700 text-sm">
            Sign up with {chatName(chat)}. You can add other sign-in methods afterward.
          </p>
        </div>

        <a href={`${apiBase}${start}`} className={`${buttonClass()} w-full`}>
          <Icon size={20} />
          Sign up with {chatName(chat)}
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
