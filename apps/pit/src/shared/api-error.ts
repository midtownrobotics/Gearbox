export async function getErrorMessage(res: Response): Promise<string> {
  if ((res.status as number) === 401) return "You must be signed in to make changes.";
  try {
    const body = (await res.clone().json()) as { error?: string };
    if (body.error) return body.error;
  } catch {}
  return `Request failed (${res.status}).`;
}
