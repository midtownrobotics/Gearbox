export async function permissionRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = data && typeof data === "object" && "error" in data ? data.error : undefined;
    throw new Error(
      error === "Forbidden."
        ? "Only Admins can manage permissions."
        : error === "Unauthorized."
          ? "Sign in to manage permissions."
          : typeof error === "string"
            ? error
            : "Could not update permissions.",
    );
  }
  return data as T;
}
