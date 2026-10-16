import packageJson from "../package.json";

// Portal (the app list) is only a page: this worker serves its build (wrangler.toml assets) and
// has no API beyond /api/health.

export default {
  fetch(request: Request): Response {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/health") {
      return Response.json({ status: "ok", service: "portal", version: packageJson.version });
    }
    return Response.json({ error: "Not found." }, { status: 404 });
  },
};
