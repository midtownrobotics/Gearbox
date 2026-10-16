import { Card, Page, buttonClass } from "@g3/ui";

/** The QR code displays (paths in kiosk/kiosk-gate.tsx), and when to use each. */
const DISPLAYS = [
  {
    path: "/kiosk",
    name: "Sign in and sign out",
    use: "Both codes side by side, for one screen by the door.",
  },
  {
    path: "/signin",
    name: "Sign in only",
    use: "For a screen at the entrance, when there's another at the exit.",
  },
  {
    path: "/signout",
    name: "Sign out only",
    use: "For a screen at the exit.",
  },
];

/** Where an admin finds the QR codes members scan, and how to put them on a shop screen. */
export function QrCodesPage() {
  const origin = window.location.origin;
  return (
    <Page
      title="QR Codes"
      description="Show a QR code on a screen in the shop. Members scan it with their phone to sign in or out."
      width="narrow"
    >
      <Card title="Displays">
        <ul className="divide-y divide-secondary-200">
          {DISPLAYS.map((display) => (
            <li
              key={display.path}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="font-medium text-secondary-900">{display.name}</p>
                <p className="text-sm text-secondary-600">{display.use}</p>
                <p className="mt-1 break-all font-mono text-xs text-secondary-500">
                  {origin}
                  {display.path}
                </p>
              </div>
              <a href={display.path} target="_blank" rel="noreferrer" className={buttonClass()}>
                Open
              </a>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Setting up a screen">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-secondary-700">
          <li>On the screen's computer, sign in with an admin account.</li>
          <li>Go to one of the addresses above and make the page full screen.</li>
          <li>
            Leave it open. The code changes every 30 seconds, so a photo of it won't work later.
          </li>
        </ol>
        <p className="mt-3 text-sm text-secondary-600">
          The display stops if that computer signs out, so use an account that stays signed in
          there.
        </p>
      </Card>
    </Page>
  );
}
