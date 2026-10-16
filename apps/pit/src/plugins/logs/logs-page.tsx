import { Card, Page } from "@g3/ui";

// Logs: the robot's match logs. Nothing fills it yet; the pit log downloader
// (devices/pit-log-downloader) will (roadmap: Pit log downloader, L.2).

export function LogsPage() {
  return (
    <Page title="Logs" description="The robot's match logs." width="narrow">
      <Card>
        <p className="text-sm text-secondary-500">No match logs yet.</p>
      </Card>
    </Page>
  );
}
