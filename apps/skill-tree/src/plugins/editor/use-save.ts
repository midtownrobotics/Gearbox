import { useState } from "react";
import { getErrorMessage } from "../../shared/api";
import { useSkillData } from "../../shared/skill-data";

type ApiResponse = { ok: boolean; status: number; json(): Promise<unknown> };

/** Runs an edit, then reloads the trees so every page shows it. `save` resolves to whether it worked. */
export function useSave() {
  const { reloadTrees } = useSkillData();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(request: () => Promise<ApiResponse>): Promise<boolean> {
    setError(null);
    setSaving(true);
    try {
      const res = await request();
      if (!res.ok) {
        setError(await getErrorMessage(res));
        return false;
      }
      await reloadTrees();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { save, saving, error };
}
