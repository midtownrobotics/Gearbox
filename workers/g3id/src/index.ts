import { corsOrigin } from "@g3/site-config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import packageJson from "../package.json";
import { adminRouter } from "./routes/admin";
import { authRouter } from "./routes/auth";
import { emailAuthRouter } from "./routes/auth/email";
import { githubAuthRouter } from "./routes/auth/github";
import { googleAuthRouter } from "./routes/auth/google";
import { onshapeAuthRouter } from "./routes/auth/onshape";
import { pinAuthRouter } from "./routes/auth/pin";
import { slackAuthRouter } from "./routes/auth/slack";
import { steamAuthRouter } from "./routes/auth/steam";
import { kioskRouter } from "./routes/kiosk";
import { onshapeRouter } from "./routes/onshape";
import { slackRouter } from "./routes/slack";
import { usersRouter } from "./routes/users";
import type { AppEnv } from "./types";

const base = new Hono<AppEnv>();

base.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal server error." }, 500);
});

base.use(
  "*",
  cors({
    origin: corsOrigin,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "x-kiosk-token"],
    credentials: true,
  }),
);

const app = base
  .get("/health", (c) => c.json({ status: "ok", service: "g3id", version: packageJson.version }))
  .route("/auth", authRouter)
  .route("/auth", emailAuthRouter)
  .route("/auth", githubAuthRouter)
  .route("/auth", googleAuthRouter)
  .route("/auth", onshapeAuthRouter)
  .route("/auth", pinAuthRouter)
  .route("/auth", slackAuthRouter)
  .route("/auth", steamAuthRouter)
  .route("/admin", adminRouter)
  .route("/users", usersRouter)
  .route("/onshape", onshapeRouter)
  .route("/", kioskRouter)
  .route("/slack", slackRouter);

export type G3IDApp = typeof app;
export default app;
