import { g3idStub, workerTestConfig } from "@g3/testing/config";
import { admin, mentor, otherStudent, student, testUser, userFromCookie } from "@g3/testing/users";

// G3ID as Skill Tree uses it: the shared stub, plus the team's accounts (the list of students
// comes from them), their roles as an admin sees them, and two kiosk PINs.
const accounts = [
  student,
  otherStudent,
  mentor,
  admin,
  // A mentor who never opens Skill Tree, and two students who never do.
  testUser({ id: "mentor-quiet", displayName: "Quinn Quiet", isMentor: true }),
  testUser({ id: "student-new", displayName: "Nia Newcomer" }),
  testUser({ id: "student-bulk", displayName: "Ben Bulk" }),
];

const json = (body: unknown, status = 200) => Response.json(body, { status });

const g3id = (request: Request) => {
  const path = new URL(request.url).pathname;
  const user = userFromCookie(request.headers.get("Cookie") ?? "");
  // Active accounts, without roles, as the real route lists them.
  if (path === "/api/users/attendance-eligible") {
    if (!user) return json({ error: "Unauthorized." }, 401);
    return json({ users: accounts.map(({ id, displayName }) => ({ id, displayName })) });
  }
  // Everyone's roles: admins only, never from a kiosk.
  if (path === "/api/admin/users") {
    if (!user?.isAdmin || user.sessionType === "pin") return json({ error: "Forbidden." }, 403);
    return json(
      accounts.map(({ id, displayName, isMentor }) => ({
        id,
        displayName,
        isMentor: isMentor ? 1 : 0,
      })),
    );
  }
  // PIN 123 is the other student's; 777 is a mentor's.
  if (path === "/api/users/by-pin/123") return json({ id: otherStudent.id });
  if (path === "/api/users/by-pin/777") return json({ id: mentor.id });
  return g3idStub(request);
};

export default workerTestConfig({ d1: "SKILL_DB", services: { G3ID: g3id } });
