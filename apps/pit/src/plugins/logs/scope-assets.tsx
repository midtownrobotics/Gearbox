import { Card, ConfirmButton, ErrorBanner } from "@g3/ui";
import { useCallback, useEffect, useState } from "react";
import {
  type ScopeAsset,
  fetchScopeAssets,
  removeScopeAsset,
} from "../../shared/getters/advantagescope";

// The fields, robots and joysticks the team uploaded in AdvantageScope (File > Upload Asset),
// which everyone on the team sees there. Mentors and admins upload and remove them.

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function ScopeAssets() {
  const [data, setData] = useState<{
    assets: ScopeAsset[];
    canManage: boolean;
    limit: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      fetchScopeAssets()
        .then((next) => {
          setData(next);
          setError(null);
        })
        .catch(() => setError("Couldn't load AdvantageScope's assets. Check your connection.")),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) return error ? <ErrorBanner message={error} /> : null;
  if (data.assets.length === 0 && !data.canManage) return null;
  const used = data.assets.reduce((sum, asset) => sum + asset.size, 0);
  return (
    <Card title="AdvantageScope assets">
      {error && <ErrorBanner message={error} />}
      <p className="mb-3 text-sm text-secondary-500">
        {megabytes(used)} of {megabytes(data.limit)} used.
      </p>
      {data.assets.length === 0 ? (
        <p className="text-sm text-secondary-500">
          Add your robot or another field in AdvantageScope with File › Upload Asset (a zip of up to
          50 MB). Everyone on the team sees them.
        </p>
      ) : (
        <ul className="divide-y divide-secondary-200">
          {data.assets.map((asset) => (
            <li key={asset.name} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-secondary-900">{asset.name}</p>
                <p className="text-xs text-secondary-500">
                  {megabytes(asset.size)} · {dateFormat.format(asset.uploadedAt)}
                </p>
              </div>
              {data.canManage && (
                <ConfirmButton
                  label="Remove"
                  size="sm"
                  question={`Remove ${asset.name} from AdvantageScope for the whole team?`}
                  onConfirm={async () => {
                    try {
                      await removeScopeAsset(asset.name);
                      await load();
                    } catch {
                      setError("Couldn't remove it. Check your connection and try again.");
                    }
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
