import { Button, Card, ErrorBanner, Loading, Page, inputClass } from "@g3/ui";
import type { SwitchSubmission } from "@g3/worker-edge/switch-types";
import { useRef, useState } from "react";
import { formatDateTime } from "../../shared/format";
import { useLoad } from "../../shared/use-load";
import { soundRequest } from "./sound-api";

async function loadSubmissions(): Promise<{ submissions: SwitchSubmission[] }> {
  return soundRequest("/submissions") as Promise<{ submissions: SwitchSubmission[] }>;
}
const labels = { pending: "Pending review", approved: "Approved", rejected: "Declined" };

export function SoundSubmissionsPage() {
  const data = useLoad(loadSubmissions, []);
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await soundRequest(`/submissions?name=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: file,
      });
      setMessage("Submitted for admin approval.");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      data.reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page title="Suggest a sound" width="narrow">
      {error && <ErrorBanner message={error} />}
      {message && (
        <p className="text-sm text-emerald-700" role="status">
          {message}
        </p>
      )}
      <Card title="Submit a clip">
        <p className="mb-3 text-sm text-secondary-500">
          Upload a WAV up to 10 MB. An admin must approve it before it can play. You can have up to
          3 pending submissions.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            ref={fileInput}
            className={`${inputClass} min-w-0 flex-1`}
            type="file"
            aria-label="Sound to submit"
            accept=".wav,audio/wav,audio/x-wav"
            disabled={busy}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <Button
            disabled={busy || !file || file.size > 10 * 1024 * 1024}
            onClick={() => void upload()}
          >
            {busy ? "Submitting..." : "Submit for approval"}
          </Button>
        </div>
        {file && file.size > 10 * 1024 * 1024 && (
          <p className="mt-2 text-sm text-red-700">Choose a file no larger than 10 MB.</p>
        )}
      </Card>
      <Card title="Submitted sounds">
        {data.error ? (
          <ErrorBanner message={data.error} />
        ) : !data.data ? (
          <Loading />
        ) : data.data.submissions.length === 0 ? (
          <p className="text-sm text-secondary-500">No submissions yet.</p>
        ) : (
          <ul className="divide-y divide-secondary-100">
            {data.data.submissions.map((submission) => (
              <li
                key={submission.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <div className="min-w-0">
                  <p className="break-all text-sm font-medium">{submission.name}</p>
                  <p className="text-xs text-secondary-500">
                    {formatDateTime(submission.submittedAt)}
                  </p>
                </div>
                <span className="rounded-full bg-secondary-100 px-2 py-1 text-xs font-medium">
                  {labels[submission.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Page>
  );
}

export function SoundReviewQueue({ onApproved }: { onApproved(): void }) {
  const data = useLoad(loadSubmissions, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function review(id: string, action: "test" | "approve" | "reject" | "stop") {
    setBusy(id);
    setError(null);
    try {
      await soundRequest(action === "stop" ? "/stop" : `/submissions/${id}/${action}`, {
        method: "POST",
      });
      data.reload();
      if (action === "approve") onApproved();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }
  const pending = data.data?.submissions.filter((submission) => submission.status === "pending");
  return (
    <Card title="Pending sound approvals" className="mx-auto w-full max-w-3xl">
      {(error || data.error) && (
        <ErrorBanner message={error || data.error || "Unable to load submissions."} />
      )}
      {!data.data && !data.error ? (
        <Loading />
      ) : !pending?.length ? (
        <p className="text-sm text-secondary-500">No sounds awaiting review.</p>
      ) : (
        <ul className="divide-y divide-secondary-100">
          {pending.map((submission) => (
            <li key={submission.id} className="space-y-2 py-3">
              <div>
                <p className="break-all text-sm font-medium">{submission.name}</p>
                <p className="text-xs text-secondary-500">
                  {submission.submittedBy} - {formatDateTime(submission.submittedAt)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => void review(submission.id, "test")}
                >
                  Test on box (25%)
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => void review(submission.id, "stop")}
                >
                  Stop sound
                </Button>
                <Button
                  disabled={busy !== null}
                  onClick={() => void review(submission.id, "approve")}
                >
                  Approve
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => void review(submission.id, "reject")}
                >
                  Decline
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
