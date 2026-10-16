import { g3idStub, workerTestConfig } from "@g3/testing/config";
import { SITE_TEAM, admin, mentor, otherStudent, student, testUser } from "@g3/testing/users";

// G3ID as Skill Tree uses it: the shared stub (any team's members, with roles), plus more of the
// site team's accounts and two kiosk PINs.
const siteMembers = [
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
  if (path === `/api/internal/teams/${SITE_TEAM}/members`) {
    return json(
      siteMembers.map(({ id, displayName, email, isAdmin, isMentor }) => ({
        id,
        displayName,
        email,
        status: "active",
        isAdmin,
        isMentor,
      })),
    );
  }
  // PIN 123 is the other student's; 777 is a mentor's.
  if (path === "/api/users/by-pin/123") return json({ id: otherStudent.id });
  if (path === "/api/users/by-pin/777") return json({ id: mentor.id });
  return g3idStub(request);
};

export default workerTestConfig({ d1: "SKILL_DB", services: { G3ID: g3id } });
