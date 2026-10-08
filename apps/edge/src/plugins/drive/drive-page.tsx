import { Card, Page } from "../../shared/ui";

const DRIVE_URL = "http://drive.local";
const DRIVE_IP_URL = "http://192.168.50.1";

/**
 * The shop drive lives on the edge box and is served by it directly on the
 * shop network, so files never cross the internet (or the hotspot). This page
 * just links there; it can't check reachability, since browsers block an
 * https page from calling a plain-http LAN address.
 */
export function DrivePage() {
  return (
    <Page title="Shop Drive">
      <Card>
        <div className="space-y-4">
          <p className="text-secondary-700">
            A shared 10 GB drive for big files (CAD exports, installers, videos). Files move over
            the shop network, not the internet.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={DRIVE_URL}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium rounded-lg px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white"
            >
              Open the drive
            </a>
            <span className="text-sm text-secondary-500">
              If that doesn't load, try{" "}
              <a
                href={DRIVE_IP_URL}
                target="_blank"
                rel="noreferrer"
                className="text-primary-500 hover:text-primary-700"
              >
                {DRIVE_IP_URL.replace("http://", "")}
              </a>
              .
            </span>
          </div>
          <ul className="text-sm text-secondary-500 list-disc pl-5 space-y-1">
            <li>Only works on the shop network (wired or shop Wi-Fi).</li>
            <li>
              Anyone on the shop network can upload, download, and delete files. Don't put anything
              private on it.
            </li>
            <li>Files aren't backed up.</li>
          </ul>
        </div>
      </Card>
    </Page>
  );
}
