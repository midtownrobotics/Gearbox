// The worker under test, so `exports.default` (from "cloudflare:workers") is typed.
declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import("../src/index");
  }
}
