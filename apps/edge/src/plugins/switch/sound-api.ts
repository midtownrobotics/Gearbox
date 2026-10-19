import { getErrorMessage } from "../../shared/api";
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
export async function soundRequest(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}/switch${path}`, { ...init, credentials: "include" });
  if (!response.ok) throw new Error(await getErrorMessage(response));
  return response.json();
}
