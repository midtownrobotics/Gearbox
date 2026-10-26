import type { TestUser } from "@g3/testing/users";
import { jsonAs } from "@g3/testing/worker";

type Id = { id: number };

/** A new project of the admin's team, with a name no other test uses. */
export const newProject = (admin: TestUser, name = `Robot ${crypto.randomUUID().slice(0, 8)}`) =>
  jsonAs<Id & { name: string }>(admin, "/projects", { method: "POST", body: { name } }, 201);

/** A subsystem in `projectId`, or in a new project of its own. */
export async function newSubsystem(admin: TestUser, name: string, projectId?: number) {
  const project = projectId ?? (await newProject(admin)).id;
  return jsonAs<Id & { name: string; projectId: number }>(
    admin,
    "/subsystems",
    { method: "POST", body: { name, projectId: project } },
    201,
  );
}
