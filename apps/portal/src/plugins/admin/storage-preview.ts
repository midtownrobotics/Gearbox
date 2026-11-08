// SPDX-License-Identifier: AGPL-3.0-only
import type { StorageReport } from "@g3/auth";

/** Development-only view of the actual Storage page; no fake API or auth bypass is shipped. */
export function storagePreview() {
  const now = Date.now();
  const apps = [
    { slug: "shop", name: "Shop", limit: 5 * 1024 ** 3, count: 142, max: 10_000, ratio: 0.91 },
    {
      slug: "scouting",
      name: "Scouting",
      limit: 2 * 1024 ** 3,
      count: 2840,
      max: 25_000,
      ratio: 0.95,
    },
    { slug: "pit", name: "Pit", limit: null, count: 20, max: 20, ratio: 1 },
  ].map((app) => ({
    slug: app.slug,
    name: app.name,
    error: null,
    report: {
      checkedAt: now,
      cutoff: new Date(new Date(now).setUTCMonth(new Date(now).getUTCMonth() - 6)).getTime(),
      allowances: [
        {
          id: app.slug === "pit" ? "logs" : "files",
          name: app.slug === "pit" ? "Pit match logs" : `${app.name} files`,
          bytes: app.limit ? app.limit * app.ratio : 16 * 1024 ** 2,
          byteLimit: app.limit,
          count: app.count,
          countLimit: app.max,
          countLabel: app.slug === "pit" ? "logs" : "files",
          files: [
            {
              key: "example-old",
              name:
                app.slug === "scouting"
                  ? "Auton — left starting position.png"
                  : app.slug === "pit"
                    ? "Spring event/Qual-13.wpilog.gz"
                    : "Drive plate — revision A.pdf",
              bytes: 2 * 1024 ** 2,
              uploadedAt: now - 220 * 86_400_000,
              eligible: true,
            },
            {
              key: "example-recent",
              name:
                app.slug === "scouting"
                  ? "Pit scouting — robot photo.png"
                  : app.slug === "pit"
                    ? "Fall event/Qual-8.wpilog.gz"
                    : "Drive plate — revision B.pdf",
              bytes: 1024 ** 2,
              uploadedAt: now - 10 * 86_400_000,
              eligibleAfter:
                new Date(
                  new Date(now - 10 * 86_400_000).setUTCMonth(
                    new Date(now - 10 * 86_400_000).getUTCMonth() + 6,
                  ),
                ).getTime() + 1,
              eligible: false,
            },
          ],
        },
      ],
    } satisfies StorageReport,
  }));
  const pit = apps.find((app) => app.slug === "pit");
  if (pit)
    (pit.report as StorageReport).allowances.push({
      id: "assets",
      name: "Pit AdvantageScope assets",
      bytes: 62 * 1024 ** 2,
      byteLimit: 100 * 1024 ** 2,
      count: 2,
      countLimit: 10,
      countLabel: "assets",
      files: [
        {
          key: "sample-model",
          name: "Robot_Example/model.glb",
          bytes: 62 * 1024 ** 2,
          uploadedAt: now - 10 * 86_400_000,
          eligible: false,
        },
      ],
    });
  return apps;
}
