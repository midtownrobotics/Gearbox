// The demo team's members. G3ID makes them on every reset with these ids, so each app's sample
// data can name them. Visitors sign in as one of the three `visitor` accounts by choosing a role;
// everyone who picks the same role shares it.

export type DemoRole = "student" | "mentor" | "admin";

export type DemoPerson = {
  id: string;
  name: string;
  email: string;
  isMentor: boolean;
  isAdmin: boolean;
  /** The role a visitor picks to be this person. */
  visitor?: DemoRole;
};

const person = (
  n: number,
  name: string,
  roles: { isMentor?: boolean; isAdmin?: boolean; visitor?: DemoRole } = {},
): DemoPerson => ({
  id: `demo-9999-${String(n).padStart(2, "0")}`,
  name,
  email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`,
  isMentor: roles.isMentor ?? false,
  isAdmin: roles.isAdmin ?? false,
  visitor: roles.visitor,
});

export const DEMO_PEOPLE: readonly DemoPerson[] = [
  person(1, "Alex Rivera", { visitor: "student" }),
  person(2, "Pat Morgan", { isMentor: true, visitor: "mentor" }),
  person(3, "Robin Hayes", { isMentor: true, isAdmin: true, visitor: "admin" }),
  person(4, "Jordan Lee"),
  person(5, "Sam Patel"),
  person(6, "Taylor Nguyen"),
  person(7, "Morgan Brooks"),
  person(8, "Casey Kim"),
  person(9, "Riley Chen"),
  person(10, "Avery Johnson"),
  person(11, "Jamie Ortiz"),
  person(12, "Quinn Walker"),
  person(13, "Chris Daniels", { isMentor: true }),
];

/** The account a visitor uses for a role. */
export function visitorFor(role: DemoRole): DemoPerson {
  const found = DEMO_PEOPLE.find((p) => p.visitor === role);
  if (!found) throw new Error(`No demo account for ${role}`);
  return found;
}

/** The demo's students (members who aren't mentors). */
export const DEMO_STUDENTS = DEMO_PEOPLE.filter((p) => !p.isMentor);

/** A demo member's id by their place in DEMO_PEOPLE, from 1 (for sample data). */
export const demoPerson = (n: number): string => `demo-9999-${String(n).padStart(2, "0")}`;
