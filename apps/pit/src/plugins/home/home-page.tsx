import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../shared/api";

type Tile = {
  to: string;
  label: string;
  desc: string;
  icon: ReactNode;
  adminOnly?: boolean;
};

const iconClass = "w-7 h-7";

const TILES: Tile[] = [
  {
    to: "/checklists",
    label: "Checklists",
    desc: "Run pre-match and pit checklists",
    icon: (
      <svg
        className={iconClass}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
  {
    to: "/editor",
    label: "Editor",
    desc: "Create and edit checklists",
    icon: (
      <svg
        className={iconClass}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    ),
  },
  {
    to: "/batteries",
    label: "Batteries",
    desc: "Track battery state and voltage",
    icon: (
      <svg
        className={iconClass}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="2" y="7" width="16" height="10" rx="2" />
        <line x1="22" y1="11" x2="22" y2="13" />
        <line x1="6" y1="10" x2="6" y2="14" />
        <line x1="10" y1="10" x2="10" y2="14" />
      </svg>
    ),
  },
  {
    to: "/monitor",
    label: "Pit Monitor",
    desc: "Live status display for the pit",
    icon: (
      <svg
        className={iconClass}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
  },
  {
    to: "/admin",
    label: "Admin",
    desc: "Event configuration",
    adminOnly: true,
    icon: (
      <svg
        className={iconClass}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      </svg>
    ),
  },
];

export function HomePage() {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    api.me
      .$get()
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setIsAdmin(data?.isAdmin === true))
      .catch(() => setIsAdmin(false));
  }, []);

  const tiles = TILES.filter((t) => !t.adminOnly || isAdmin);

  return (
    <main className="min-h-screen bg-page text-gray-900">
      <div className="max-w-3xl mx-auto px-4 py-12 sm:py-16 space-y-10">
        <div className="text-center space-y-3">
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight">G3 Pit Software</h1>
          <p className="text-red-400 font-semibold text-lg tracking-widest uppercase">
            Pit Management and Operations
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {tiles.map((tile) => (
            <Link
              key={tile.to}
              to={tile.to}
              className="group bg-white hover:bg-gray-100 border border-gray-200 hover:border-red-600 rounded-2xl p-5 flex items-center gap-4 transition-colors"
            >
              <div className="shrink-0 w-12 h-12 rounded-xl bg-gray-100 group-hover:bg-red-600/20 flex items-center justify-center text-red-400 transition-colors">
                {tile.icon}
              </div>
              <div className="min-w-0">
                <p className="text-lg font-semibold text-gray-900 group-hover:text-red-400 transition-colors">
                  {tile.label}
                </p>
                <p className="text-sm text-gray-600 truncate">{tile.desc}</p>
              </div>
              <span className="ml-auto text-gray-600 group-hover:text-red-400 transition-colors">
                →
              </span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
