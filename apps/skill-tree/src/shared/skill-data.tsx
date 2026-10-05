import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, getErrorMessage } from "./api";
import type { Status, Student, Tree, TreeSetInfo } from "./progress";
import { ErrorBanner, Page, PageLoading } from "./ui";

// The team's trees and everyone's progress, loaded once and shared by every page. Progress is fetched
// again when the tab is looked at and every minute while it stays open, so a student sees a
// sign-off a mentor just made on another device.

const REFRESH_MS = 60_000;

type SkillData = {
  treeSet: TreeSetInfo;
  trees: Tree[];
  students: Student[];
  reloadTrees: () => Promise<void>;
  reloadStudents: () => Promise<void>;
  /** Shows a sign-off right away, before the server has answered. */
  markLocally: (userIds: string[], skillIds: number[], status: Status) => void;
};

const SkillDataContext = createContext<SkillData | null>(null);

export function useSkillData(): SkillData {
  const data = useContext(SkillDataContext);
  if (!data) throw new Error("useSkillData must be used inside SkillDataProvider");
  return data;
}

async function fetchTrees() {
  const res = await api.trees.$get();
  if (!res.ok) throw new Error(await getErrorMessage(res));
  return res.json();
}

async function fetchStudents() {
  const res = await api.students.$get();
  if (!res.ok) throw new Error(await getErrorMessage(res));
  return (await res.json()).students;
}

export function SkillDataProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState<{ set: TreeSetInfo; trees: Tree[] } | null>(null);
  const [students, setStudents] = useState<Student[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reloadTrees = useCallback(async () => setLoaded(await fetchTrees()), []);
  const reloadStudents = useCallback(async () => setStudents(await fetchStudents()), []);

  useEffect(() => {
    Promise.all([reloadTrees(), reloadStudents()]).catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }, [reloadTrees, reloadStudents]);

  useEffect(() => {
    // A failed refresh keeps what is on screen; the next one tries again.
    const refresh = () => {
      if (document.visibilityState === "visible") reloadStudents().catch(() => {});
    };
    const timer = window.setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [reloadStudents]);

  const markLocally = useCallback((userIds: string[], skillIds: number[], status: Status) => {
    setStudents(
      (current) =>
        current?.map((student) => {
          if (!userIds.includes(student.userId)) return student;
          const progress = { ...student.progress };
          for (const id of skillIds) {
            if (status === "not-started") delete progress[id];
            else progress[id] = status;
          }
          return { ...student, progress };
        }) ?? null,
    );
  }, []);

  const value = useMemo(
    () =>
      loaded && students
        ? {
            treeSet: loaded.set,
            trees: loaded.trees,
            students,
            reloadTrees,
            reloadStudents,
            markLocally,
          }
        : null,
    [loaded, students, reloadTrees, reloadStudents, markLocally],
  );

  if (error) {
    return (
      <Page title="Skill Tree">
        <ErrorBanner message={error} />
      </Page>
    );
  }
  if (!value) return <PageLoading />;
  return <SkillDataContext.Provider value={value}>{children}</SkillDataContext.Provider>;
}
