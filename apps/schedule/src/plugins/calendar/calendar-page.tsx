import { Card, Page } from "@g3/ui";

export function CalendarPage() {
  return (
    <Page title="Calendar" description="The team's meetings, events and deadlines.">
      <Card>
        <p className="text-sm text-secondary-400">Nothing scheduled yet.</p>
      </Card>
    </Page>
  );
}
