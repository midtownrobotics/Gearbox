/* FRC Skill Trees — G3 backend shim.
 *
 * This module preserves the exact export surface app.js imported from the old
 * Firebase module, but is backed by G3ID (auth) and the skill-tree Cloudflare
 * Worker (data). app.js is unchanged: it still calls onAuthStateChanged,
 * collection/doc/getDoc/setDoc/updateDoc/onSnapshot exactly as before.
 *
 * Auth is entirely cookie/SSO based — there is no in-app login form. If the
 * stored g3_session cookie is valid the app loads immediately; otherwise the
 * browser is redirected to the G3ID login page, which returns here afterward.
 * Firestore's realtime onSnapshot is emulated by polling.
 */

import { apiUrl, appUrl } from "@g3/site-config";
const isLocal =
  location.hostname === "localhost" || location.hostname === "127.0.0.1";

// G3ID API (login/logout + session validation via the worker's service binding)
// and the G3ID web app (the hosted login page we redirect unauthenticated
// users to). The skill-tree worker serves the app's data.
const G3ID_API = isLocal ? "http://localhost:8787" : apiUrl("id");
const G3ID_WEB = isLocal ? "http://localhost:5173" : appUrl("id");
const API_URL = isLocal ? "http://localhost:8790" : apiUrl("skillTree");

const POLL_INTERVAL_MS = 4000;

// The in-app login screen is obsolete — hide it so it never flashes while the
// session is being checked or the redirect is in flight.
document.getElementById("loginScreen")?.style.setProperty("display", "none");

// Opaque handles — app.js passes these through to the functions below.
export const auth = { __g3: true };
export const db = { __g3: true };

// ── Auth ────────────────────────────────────────────────────────────────────

function redirectToLogin() {
  window.location.href = `${G3ID_WEB}/login?redirect=${encodeURIComponent(window.location.href)}`;
}

async function fetchMe() {
  try {
    const res = await fetch(`${API_URL}/me`, { credentials: "include" });
    if (!res.ok) return null;
    const me = await res.json();
    return {
      uid: me.id,
      displayName: me.displayName,
      isMentor: me.isMentor,
      isAdmin: me.isAdmin,
    };
  } catch {
    return null;
  }
}

// ── Mentor management (admin only) ────────────────────────────────────────────

export async function listMentors() {
  const res = await fetch(`${API_URL}/mentors`, { credentials: "include" });
  if (!res.ok) return [];
  return res.json(); // [{ id, displayName }]
}

export async function addMentor(uid) {
  await fetch(`${API_URL}/mentors/${encodeURIComponent(uid)}`, {
    method: "POST",
    credentials: "include",
  });
}

export async function removeMentor(uid) {
  await fetch(`${API_URL}/mentors/${encodeURIComponent(uid)}`, {
    method: "DELETE",
    credentials: "include",
  });
}

export function onAuthStateChanged(_auth, cb) {
  // No login prompt: if the cookie is valid, hand the user to the app; if not,
  // send them straight to G3ID and never invoke the "logged out" callback.
  fetchMe().then((user) => {
    if (user) cb(user);
    else redirectToLogin();
  });
  return () => {};
}

// Retained for the import surface; with SSO there's no in-app sign-in form, so
// this just routes to the G3ID login page.
export async function signInWithEmailAndPassword() {
  redirectToLogin();
}

export async function signOut(_auth) {
  try {
    await fetch(`${G3ID_API}/auth/logout`, { method: "POST", credentials: "include" });
  } catch {
    // Even if the network call fails, send the user back to G3ID.
  }
  redirectToLogin();
}

// ── Firestore-compatible shim ─────────────────────────────────────────────────
//
// The old code used: doc(db, 'students'|'mentors', id), collection(db,'students'),
// getDoc (mentors), setDoc/updateDoc (students progress), onSnapshot (students).

export function collection(_db, name) {
  return { __collection: name };
}

export function doc(_db, collectionName, id) {
  return { __doc: true, collection: collectionName, id };
}

export async function getDoc(ref) {
  // Only used for mentors/{uid}; return a snapshot with exists()/data().
  if (ref.collection === "mentors") {
    try {
      const res = await fetch(`${API_URL}/mentors/${encodeURIComponent(ref.id)}`, {
        credentials: "include",
      });
      const json = res.ok ? await res.json() : { exists: false };
      return { exists: () => !!json.exists, data: () => ({}) };
    } catch {
      return { exists: () => false, data: () => ({}) };
    }
  }
  return { exists: () => false, data: () => ({}) };
}

// Both setDoc and updateDoc carry a single skill change in one of two shapes:
//   updateDoc: { 'progress.<skillId>': status }
//   setDoc:    { progress: { <skillId>: status } }
function extractSkill(data) {
  for (const key of Object.keys(data)) {
    if (key.startsWith("progress.")) {
      return { skillId: key.slice("progress.".length), status: data[key] };
    }
    if (key === "progress" && data[key] && typeof data[key] === "object") {
      const skillId = Object.keys(data[key])[0];
      return { skillId, status: data[key][skillId] };
    }
  }
  return null;
}

async function writeSkill(studentId, data) {
  const change = extractSkill(data);
  if (!change || !change.skillId) return;
  const res = await fetch(`${API_URL}/students/${encodeURIComponent(studentId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(change),
  });
  // app.js treats updateDoc as a promise that rejects to trigger a setDoc
  // fallback; a failed write should reject so that path still works.
  if (!res.ok) throw new Error(`Write failed (${res.status})`);
}

export function updateDoc(ref, data) {
  return writeSkill(ref.id, data);
}

export function setDoc(ref, data, _opts) {
  return writeSkill(ref.id, data);
}

// Emulate Firestore's realtime listener over the students collection by polling.
export function onSnapshot(ref, cb) {
  if (!ref || ref.__collection !== "students") {
    return () => {};
  }

  let stopped = false;
  let timer = null;

  async function poll() {
    if (stopped) return;
    try {
      const res = await fetch(`${API_URL}/students`, { credentials: "include" });
      if (res.ok) {
        const rows = await res.json();
        const snapshot = {
          forEach(fn) {
            for (const row of rows) {
              fn({
                id: row.id,
                data: () => ({ progress: row.progress || {}, displayName: row.displayName }),
              });
            }
          },
        };
        cb(snapshot);
      }
    } catch {
      // Transient error — keep polling.
    }
    if (!stopped) timer = setTimeout(poll, POLL_INTERVAL_MS);
  }

  poll();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
