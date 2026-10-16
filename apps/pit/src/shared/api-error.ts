import { redirectToSignIn } from "@g3/ui";

export async function getErrorMessage(res: Response): Promise<string> {
  if ((res.status as number) === 401) {
    redirectToSignIn();
    return "Redirecting to sign in…";
  }
  try {
    const body = (await res.clone().json()) as { error?: string };
    if (body.error) return body.error;
  } catch {}
  return `Request failed (${res.status}).`;
}
