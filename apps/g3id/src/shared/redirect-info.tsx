import { useSearchParams } from "react-router-dom";

export function RedirectInfo() {
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get("redirect");

  if (!redirect) return null;

  const url = new URL(redirect);
  const subdomain = url.host.split(".")[0];
  const appName = subdomain.charAt(0).toUpperCase() + subdomain.slice(1);

  return (
    <div className="bg-secondary-100 text-secondary-900 px-6 py-1 text-center">
      <span>
        Logging into{" "}
        <a className="text-blue-700 underline" href={redirect}>
          {appName}
        </a>{" "}
        Software
      </span>
    </div>
  );
}
