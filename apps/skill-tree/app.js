/* FRC Skill Trees — application logic */
import { apiUrl, appUrl } from '@g3/site-config';
import { TREES } from './data/trees.js';
import {
  auth, db,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  collection, doc, getDoc, setDoc, updateDoc, onSnapshot,
  listMentors, addMentor, removeMentor,
} from './firebase.js';

// API URLs
const isDev=window.location.hostname==='localhost'||window.location.hostname==='127.0.0.1';
const G3ID_API=localStorage.getItem('g3id_api')||(isDev?'http://localhost:8787':apiUrl('id'));
const SKILL_TREE_API=localStorage.getItem('skill_tree_api')||(isDev?'http://localhost:8790':'/api');

// ═══════════════════════════════════════════════════════
// LAYOUT ENGINE
// ═══════════════════════════════════════════════════════
let NW=164, NH=72, CG=60; // node width / height / horizontal gap
let LANE_H=20, STUB=24, CHAN_CLEAR=16, LANE_W=16, RG_MIN=48; // channel-routing metrics
let RC=18; // edge corner radius — scaled with layout constants at render time

// ── LAYOUT ──────────────────────────────────────────────
function layout(nodes) {
  // 1. Rank assignment (longest path from roots)
  const rank = {};
  nodes.forEach(n => { rank[n.id] = 0; });
  let changed = true;
  while (changed) {
    changed = false;
    nodes.forEach(n => {
      n.prereqs.forEach(pid => {
        if (rank[pid] === undefined) return; // prereq outside this set
        if (rank[pid] + 1 > rank[n.id]) { rank[n.id] = rank[pid] + 1; changed = true; }
      });
    });
  }

  // 2. Group by rank
  const byRank = {};
  nodes.forEach(n => {
    const r = rank[n.id];
    if (!byRank[r]) byRank[r] = [];
    byRank[r].push(n);
  });
  const maxRank = Math.max(...nodes.map(n => rank[n.id]));

  // 3. Pack each rank tightly (uniform CG gap), ordered by the barycentre of
  //    parents so children sit under their parents, then centre every rank on a
  //    common axis. This keeps the tree compact — no large horizontal gaps
  //    between unrelated branches or single nodes. The channel router below
  //    handles edge routing for whatever positions this produces.
  const pos = {};
  const ranks = Object.keys(byRank).map(Number).sort((a,b)=>a-b);
  ranks.forEach(r => {
    const ordered = [...byRank[r]].sort((a,b) => {
      const ax = a.prereqs.map(p => pos[p] ? pos[p].x : null).filter(v => v !== null);
      const bx = b.prereqs.map(p => pos[p] ? pos[p].x : null).filter(v => v !== null);
      const am = ax.length ? ax.reduce((s,v)=>s+v,0)/ax.length : 0;
      const bm = bx.length ? bx.reduce((s,v)=>s+v,0)/bx.length : 0;
      return am - bm;
    });
    ordered.forEach((n, i) => { pos[n.id] = { x: i*(NW+CG), y: 0 }; });
  });
  const widthOf = r => (byRank[r].length - 1) * (NW + CG);
  const maxWidth = Math.max(...ranks.map(widthOf));
  ranks.forEach(r => {
    const offset = (maxWidth - widthOf(r)) / 2;
    byRank[r].forEach(n => { pos[n.id].x = Math.round(pos[n.id].x + offset); });
  });

  // 6. Assign chanX for all non-direct edges (needed before gap sizing)
  const chanXMap = {};
  const canvasW = Math.max(...Object.values(pos).map(p => p.x)) + NW;
  nodes.forEach(n => {
    n.prereqs.forEach(pid => {
      const sp = pos[pid], dp = pos[n.id];
      if (!sp || !dp) return;
      const x1 = sp.x + NW/2, x2 = dp.x + NW/2;
      if (Math.abs(x1 - x2) < 2) return; // direct
      const nomX = (x1 + x2) / 2;
      // Snap away from card bodies and center-x stubs with generous buffers
      const intervals = [];
      nodes.forEach(m => {
        const mr = rank[m.id];
        if (mr <= rank[pid] || mr >= rank[n.id]) return;
        const mp = pos[m.id]; if (!mp) return;
        intervals.push([mp.x - CHAN_CLEAR, mp.x + NW + CHAN_CLEAR]);
      });
      nodes.forEach(m => {
        const mr = rank[m.id];
        if (mr < rank[pid] || mr > rank[n.id]) return;
        const mp = pos[m.id]; if (!mp) return;
        const cx = mp.x + NW/2;
        intervals.push([cx - LANE_W*2, cx + LANE_W*2]); // doubled buffer
      });
      const clear = x => !intervals.some(([a,b]) => x > a && x < b);
      let chanX = nomX;
      if (!clear(nomX)) {
        for (let d = LANE_W; d < canvasW; d += LANE_W) {
          if (clear(nomX - d)) { chanX = nomX - d; break; }
          if (clear(nomX + d)) { chanX = nomX + d; break; }
        }
      }
      chanXMap[pid + '->' + n.id] = isFinite(chanX) ? chanX : nomX;
    });
  });

  // 7. Per-gap interval coloring to determine track counts and assignments
  //    A "segment" is a horizontal line at some y, spanning [xL, xR].
  //    Departures: from x1 to chanX (or jog: from x1 to x2 through chanX midpoint)
  //    Arrivals:   from chanX to x2
  //    Two segments conflict ↔ their x-intervals overlap.
  //    Interval graph coloring: sort by xL, greedily assign lowest free track.

  // For each gap g, collect segments:
  //   dep: any edge with srcRank=g (non-adjacent: dep segment; adjacent: jog segment)
  //   arr: any edge with dstRank-1=g AND non-adjacent (arrival segment)
  const gapSegs = {}; // g → [{key, type, xL, xR, chanX, srcId, dstId, isDep}]
  for (let g = 0; g <= maxRank; g++) gapSegs[g] = [];

  nodes.forEach(n => {
    n.prereqs.forEach(pid => {
      const sp = pos[pid], dp = pos[n.id];
      if (!sp || !dp) return;
      const x1 = sp.x + NW/2, x2 = dp.x + NW/2;
      const srcR = rank[pid], dstR = rank[n.id];
      const adj = dstR - srcR === 1;
      const direct = Math.abs(x1 - x2) < 2;
      const key = pid + '->' + n.id;
      const chanX = direct ? x1 : chanXMap[key];
      if (!isFinite(chanX)) return;

      if (adj) {
        // Jog: use the rendered horizontal span (x1→chanX), not full x1→x2
        // because the coloring must reflect what actually gets drawn
        gapSegs[srcR].push({ key, type:'jog', xL:Math.min(x1,chanX), xR:Math.max(x1,chanX), chanX, srcId:pid, dstId:n.id, x1, x2, direct });
      } else {
        // Departure: x1 to chanX
        gapSegs[srcR].push({ key, type:'dep', xL:Math.min(x1,chanX), xR:Math.max(x1,chanX), chanX, srcId:pid, dstId:n.id, x1, x2, direct });
        // Arrival: chanX to x2
        gapSegs[dstR-1].push({ key, type:'arr', xL:Math.min(chanX,x2), xR:Math.max(chanX,x2), chanX, srcId:pid, dstId:n.id, x1, x2, direct });
      }
    });
  });

  // Interval graph coloring per gap
  // Returns {trackCount, trackOf: {key+type → trackIndex}}
  function colorGap(segs) {
    if (!segs.length) return { trackCount: 0, trackOf: {} };

    // Sort segments by ordering rule:
    // deps: left-going (chanX<x1) ascending chanX (farthest=smallest=top),
    //       right-going (chanX>=x1) descending chanX (farthest=largest=top)
    // arrs: right-coming (chanX>=x2) ascending chanX (closest=top),
    //       left-coming (chanX<x2) descending chanX (closest=top)
    // jogs: by chanX ascending (same rule as dep)
    // Place dep/jog group on top, arr group below.
    const deps = segs.filter(s => s.type==='dep'||s.type==='jog');
    const arrs = segs.filter(s => s.type==='arr');

    function sortDeps(segs) {
      const left  = segs.filter(s => s.chanX <  s.x1).sort((a,b) => a.chanX - b.chanX);
      const right = segs.filter(s => s.chanX >= s.x1).sort((a,b) => b.chanX - a.chanX);
      return [...left, ...right];
    }
    function sortArrs(segs) {
      const right = segs.filter(s => s.chanX >= s.x2).sort((a,b) => a.chanX - b.chanX);
      const left  = segs.filter(s => s.chanX <  s.x2).sort((a,b) => b.chanX - a.chanX);
      return [...right, ...left];
    }

    const orderedDeps = sortDeps(deps);
    const orderedArrs = sortArrs(arrs);
    const ordered = [...orderedDeps, ...orderedArrs];

    // Greedy interval coloring: assign each segment the lowest track
    // not occupied by any overlapping earlier segment.
    // Track 0 = top (lowest y), track N-1 = bottom.
    const trackOf = {};
    const trackEnd = []; // trackEnd[t] = xR of last segment assigned to track t

    ordered.forEach(s => {
      const segKey = s.key + ':' + s.type;
      // Find lowest track whose last segment ends before this one starts
      let t = 0;
      while (t < trackEnd.length && trackEnd[t] > s.xL + 1) t++;
      if (t === trackEnd.length) trackEnd.push(0);
      trackEnd[t] = s.xR;
      trackOf[segKey] = t;
    });

    // Separate dep tracks from arr tracks to enforce deps-above-arrs:
    // Find max dep track, shift arr tracks to start above it.
    const depTracks = orderedDeps.map(s => trackOf[s.key+':'+s.type]);
    const arrTracks = orderedArrs.map(s => trackOf[s.key+':'+s.type]);
    const maxDepTrack = depTracks.length ? Math.max(...depTracks) : -1;
    // Re-run coloring for arrs starting from maxDepTrack+1
    const arrTrackEnd = new Array(maxDepTrack + 1).fill(Infinity); // dep tracks are "full"
    orderedArrs.forEach(s => {
      const segKey = s.key + ':' + s.type;
      let t = maxDepTrack + 1;
      while (t < arrTrackEnd.length && arrTrackEnd[t] !== undefined && arrTrackEnd[t] > s.xL + 1) t++;
      if (t >= arrTrackEnd.length) {
        while (arrTrackEnd.length <= t) arrTrackEnd.push(0);
      }
      arrTrackEnd[t] = s.xR;
      trackOf[segKey] = t;
    });

    const allTracks = Object.values(trackOf);
    const trackCount = allTracks.length ? Math.max(...allTracks) + 1 : 0;
    return { trackCount, trackOf };
  }

  const gapColorings = {};
  for (let g = 0; g <= maxRank; g++) {
    gapColorings[g] = colorGap(gapSegs[g]);
  }

  // 8. Size gaps from track counts
  const gapHeights = [];
  for (let g = 0; g <= maxRank; g++) {
    const tc = gapColorings[g].trackCount;
    gapHeights.push(Math.max(RG_MIN, 2*STUB + Math.max(0, tc-1)*LANE_H + LANE_H));
  }

  // 9. Assign y positions from gap heights
  const rankY = [0];
  for (let r = 1; r <= maxRank; r++) rankY[r] = rankY[r-1] + NH + gapHeights[r-1];
  nodes.forEach(n => { pos[n.id].y = rankY[rank[n.id]]; });

  const vals = Object.values(pos);
  return { pos, rank, gapHeights, rankY, gapColorings, gapSegs, chanXMap,
           cw: Math.max(...vals.map(p => p.x)) + NW,
           ch: Math.max(...vals.map(p => p.y)) + NH };
}

// ── EDGE LAYOUT ─────────────────────────────────────────
// Converts track assignments into y offsets for edgePath.
function buildEdgeLayout(nodes, pos, rank, gapHeights, rankY, gapColorings, gapSegs, chanXMap) {
  const layouts = {};

  // Initialise all edges
  nodes.forEach(n => {
    n.prereqs.forEach(pid => {
      const sp = pos[pid], dp = pos[n.id];
      if (!sp || !dp) return;
      const x1 = sp.x + NW/2, x2 = dp.x + NW/2;
      const key = pid + '->' + n.id;
      const direct = Math.abs(x1 - x2) < 2;
      const chanX = direct ? x1 : chanXMap[key];
      layouts[key] = { direct: direct || !isFinite(chanX), chanX: chanX || x1, yDepartOff: 0, yArriveOff: 0 };
    });
  });

  // Convert track index → y position within gap
  // Track 0 = top = lowest y = gapTop + STUB
  // Track N-1 = bottom = highest y = gapTop + gapH - STUB
  function trackY(g, trackIdx, trackCount) {
    const gapTop = rankY[g] + NH;
    const gapBot = rankY[g] + NH + gapHeights[g];
    const usable = gapBot - gapTop - 2*STUB; // space between stubs
    if (trackCount <= 1) return gapTop + STUB + usable/2;
    return gapTop + STUB + trackIdx * (usable / (trackCount - 1));
  }

  for (let g = 0; g <= Math.max(...nodes.map(n => rank[n.id])); g++) {
    const { trackCount, trackOf } = gapColorings[g];
    const segs = gapSegs[g];
    segs.forEach(s => {
      const segKey = s.key + ':' + s.type;
      const t = trackOf[segKey];
      if (t === undefined) return;
      const y = trackY(g, t, trackCount);
      const info = layouts[s.key];
      if (!info) return;
      if (s.type === 'dep' || s.type === 'jog') {
        const baseY = pos[s.srcId].y + NH + STUB;
        info.yDepartOff = y - baseY;
      } else {
        const baseY = pos[s.dstId].y - STUB;
        info.yArriveOff = y - baseY;
      }
    });
  }

  return layouts;
}

// ── EDGE PATH ───────────────────────────────────────────
// Converts edge layout info into an SVG path string.
// Three cases:
//   1. Same column (direct): straight vertical line
//   2. Adjacent rows, different column: 3 segments (down | horiz | up)
//   3. Non-adjacent rows, different column: 5 segments
function edgePath(pos, rank, cw, srcId, dstId, nodeList, edgeLayouts) {
  const sp = pos[srcId], dp = pos[dstId];
  const x1 = sp.x + NW/2, y1 = sp.y + NH;
  const x2 = dp.x + NW/2, y2 = dp.y;
  const srcR = rank[srcId], dstR = rank[dstId];
  const adjacent = (dstR - srcR) === 1;
  const info = edgeLayouts[srcId + '->' + dstId] || { direct: true };

  if (info.direct || Math.abs(x1 - x2) < 2) {
    return 'M' + x1 + ',' + y1 + ' L' + x2 + ',' + y2;
  }

  const chanX = info.chanX;
  const sx1 = Math.sign(chanX - x1) || 1;
  const sx2 = Math.sign(x2 - chanX) || 1;
  const s = [];

  function cap2(r, len) { return Math.max(0, Math.min(r, (Math.abs(len) - 1) / 2)); }
  function cap1(r, len) { return Math.max(0, Math.min(r, Math.abs(len) - 1)); }

  if (adjacent) {
    const yMid = y1 + STUB + (info.yDepartOff || 0);
    const v1 = yMid - y1, h = x2 - x1, v2 = y2 - yMid;
    const r1 = Math.min(cap1(RC, v1), cap2(RC, h));
    const r2 = Math.min(cap2(RC, h), cap1(RC, v2));
    const safe1 = Math.max(0, r1), safe2 = Math.max(0, r2);
    s.push('M' + x1 + ',' + y1);
    s.push('L' + x1 + ',' + (yMid - safe1));
    s.push('Q' + x1 + ',' + yMid + ' ' + (x1 + sx1*safe1) + ',' + yMid);
    s.push('L' + (x2 - sx2*safe2) + ',' + yMid);
    s.push('Q' + x2 + ',' + yMid + ' ' + x2 + ',' + (yMid + safe2));
    s.push('L' + x2 + ',' + y2);
    return s.join(' ');
  }

  const yDepart = y1 + STUB + (info.yDepartOff || 0);
  const yArrive = y2 - STUB + (info.yArriveOff || 0);
  const v1 = yDepart - y1, h1 = chanX - x1, v2 = yArrive - yDepart, h2 = x2 - chanX, v3 = y2 - yArrive;
  const r1 = Math.min(cap1(RC, v1), cap2(RC, h1));
  const r2 = Math.min(cap2(RC, h1), cap2(RC, v2));
  const r3 = Math.min(cap2(RC, v2), cap2(RC, h2));
  const r4 = Math.min(cap2(RC, h2), cap1(RC, v3));

  s.push('M' + x1 + ',' + y1);
  s.push('L' + x1 + ',' + (yDepart - r1));
  s.push('Q' + x1 + ',' + yDepart + ' ' + (x1 + sx1*r1) + ',' + yDepart);
  s.push('L' + (chanX - sx1*r2) + ',' + yDepart);
  s.push('Q' + chanX + ',' + yDepart + ' ' + chanX + ',' + (yDepart + r2));
  s.push('L' + chanX + ',' + (yArrive - r3));
  s.push('Q' + chanX + ',' + yArrive + ' ' + (chanX + sx2*r3) + ',' + yArrive);
  s.push('L' + (x2 - sx2*r4) + ',' + yArrive);
  s.push('Q' + x2 + ',' + yArrive + ' ' + x2 + ',' + (yArrive + r4));
  s.push('L' + x2 + ',' + y2);
  return s.join(' ');
}


// ═══════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════
let students = {};          // { uid: progressMap } — loaded from Firestore /students collection
let displayNames = {};      // { uid: displayName } — populated alongside students
let cur = null;             // currently selected student name
let selNode = null, selTree = null, view = 'ov', curTree = 'safety';
let userRole = 'student';   // 'mentor' | 'student'
let isAdmin = false;        // G3ID site admin — can manage the mentor list
let currentUser = null;
let unsubStudents = null;   // Firestore listener cleanup function
let openTree = null, openCat = null; // currently-open sub-tree overlay (tree, catId)

function gst(id) { return cur && students[cur] ? (students[cur][id] || 'not-started') : 'not-started'; }

// ── Category helpers ───────────────────────────────────
function catNodesOf(tree,catId){return tree.nodes.filter(n=>n.cat===catId);}
function catComplete(tree,catId){const ns=catNodesOf(tree,catId);return ns.length>0&&ns.every(n=>gst(n.id)==='complete');}
function catUnlocked(tree,cat){
  if(tree.gate==='safety'&&!sdone())return false;
  return (cat.prereqs||[]).every(pid=>catComplete(tree,pid));
}
// Display state for a category box: locked | available | in-progress | complete
function catDsp(tree,cat){
  if(!catUnlocked(tree,cat))return'locked';
  if(catComplete(tree,cat.id))return'complete';
  const ns=catNodesOf(tree,cat.id);
  return ns.some(n=>gst(n.id)!=='not-started')?'in-progress':'available';
}

function unlocked(node,tree){
  const cat=(tree.cats||[]).find(c=>c.id===node.cat);
  if(cat&&!catUnlocked(tree,cat))return false;       // category gate
  return node.prereqs.every(pid=>gst(pid)==='complete'); // in-category prereqs
}
function dsp(node,tree){const r=gst(node.id);if(!unlocked(node,tree))return'locked';return r==='not-started'?'available':r;}
function sdone(){return TREES.find(t=>t.id==='safety').nodes.every(n=>gst(n.id)==='complete');}
function tprog(tree){const t=tree.nodes.length,d=tree.nodes.filter(n=>gst(n.id)==='complete').length,p=tree.nodes.filter(n=>gst(n.id)==='in-progress').length;return{t,d,p};}
function findN(id){for(const t of TREES){const n=t.nodes.find(n=>n.id===id);if(n)return{node:n,tree:t};}return null;}

// ═══════════════════════════════════════════════════════
// AUTH & FIREBASE
// ═══════════════════════════════════════════════════════

async function initApp(user) {
  currentUser = user;

  // Determine role: mentors have a document in /mentors/{uid}
  try {
    const mentorSnap = await getDoc(doc(db, 'mentors', user.uid));
    userRole = mentorSnap.exists() ? 'mentor' : 'student';
  } catch(e) {
    userRole = 'student';
  }

  // Site admins manage the mentor list — reveal the Mentors tab for admins and mentors.
  isAdmin = !!user.isAdmin;
  document.getElementById('navMn').style.display = (isAdmin || userRole === 'mentor') ? '' : 'none';

  // Hide login screen, restore tree-selector initial state
  document.getElementById('loginScreen').classList.add('hidden');
  document.querySelector('.tree-sel-wrap').classList.add('hidden');

  // Real-time listener for all students — fires immediately with cached data,
  // then again on every change from any client.
  unsubStudents = onSnapshot(collection(db, 'students'), snapshot => {
    const fresh = {}, freshNames = {};
    snapshot.forEach(d => {
      const data = d.data();
      fresh[d.id]      = data.progress    || {};
      freshNames[d.id] = data.displayName || d.id; // fall back to UID if field missing
    });
    students     = fresh;
    displayNames = freshNames;

    // Helper: sort UIDs by their display name
    const byName = (a, b) => (displayNames[a] || a).localeCompare(displayNames[b] || b);
    const sortedUids = Object.keys(students).sort(byName);

    if (!cur) {
      // First load: students land on their own profile (doc ID = their UID);
      // mentors fall back to the first student sorted by display name.
      cur = students[currentUser.uid] ? currentUser.uid : (sortedUids[0] || null);
    } else if (!students[cur]) {
      // Selected student no longer exists — fall back gracefully.
      cur = sortedUids[0] || null;
    }

    if (view === 'ov') renderOv();
    else renderTrees();
  });
}

function doLogin() {
  console.log('doLogin called');
  try {
    const g3idBase = window.location.hostname === 'localhost' ? 'http://localhost:5173' : appUrl('id');
    const returnUrl = encodeURIComponent(window.location.href);
    const redirectUrl = g3idBase + '/login?redirect=' + returnUrl;
    console.log('Redirecting to:', redirectUrl);
    window.location.href = redirectUrl;
  } catch (e) {
    console.error('doLogin error:', e);
  }
}

function doLogout() {
  if (unsubStudents) { unsubStudents(); unsubStudents = null; }
  students = {}; displayNames = {}; cur = null; userRole = 'student'; currentUser = null;
  closePanel();
  const g3idBase = window.location.hostname === 'localhost' ? 'http://localhost:5173' : appUrl('id');
  window.location.href = g3idBase + '/logout';
}

// Persist a single skill update to Firestore (fire-and-forget; optimistic UI)
function saveSkill(skillId, status) {
  if (!cur) return;
  updateDoc(doc(db, 'students', cur), { [`progress.${skillId}`]: status })
    .catch(() => {
      // Document may not exist yet — create it
      setDoc(doc(db, 'students', cur), { progress: { [skillId]: status } }, { merge: true });
    });
}

// Auth state listener — fires on page load and on every sign-in/sign-out
onAuthStateChanged(auth, user => {
  if (user) {
    initApp(user);
  } else {
    document.getElementById('loginScreen').classList.remove('hidden');
  }
});

// Login form keyboard shortcuts

// ═══════════════════════════════════════════════════════
// VIEW SWITCH
// ═══════════════════════════════════════════════════════
function go(v){
  view=v;
  document.getElementById('vOv').classList.toggle('act',v==='ov');
  document.getElementById('vTr').classList.toggle('act',v==='tr');
  document.getElementById('vMn').classList.toggle('act',v==='mn');
  document.getElementById('navOv').classList.toggle('act',v==='ov');
  document.getElementById('navTr').classList.toggle('act',v==='tr');
  document.getElementById('navMn').classList.toggle('act',v==='mn');
  // Tree selector only visible on skill trees tab
  document.querySelector('.tree-sel-wrap').classList.toggle('hidden',v!=='tr');
  if(v==='mn')renderMentors();else if(v==='ov')renderOv();else renderTrees();
}

// ═══════════════════════════════════════════════════════
// MENTOR MANAGEMENT (admin only)
// ═══════════════════════════════════════════════════════
async function renderMentors(){
  const wrap=document.getElementById('mnWrap');
  wrap.innerHTML='<div class="mn-empty">Loading…</div>';
  const mentors=await listMentors();
  const mentorIds=new Set(mentors.map(m=>m.id));
  const byName=(a,b)=>(displayNames[a]||a).localeCompare(displayNames[b]||b);
  const candidates=Object.keys(students).filter(uid=>!mentorIds.has(uid)).sort(byName);
  const rows=mentors.slice().sort((a,b)=>(a.displayName||a.id).localeCompare(b.displayName||b.id))
    .map(m=>`<div class="mn-row"><div class="mn-name">${m.displayName||m.id}</div>${m.isAdmin ? '' : `<button class="mn-rm" onclick="mnRemove('${m.id}')">Remove</button>`}</div>`).join('');
  wrap.innerHTML=`
    <div style="margin-bottom:20px;"><button id="bulkBtn" style="background:var(--accent);border:none;color:#000;padding:8px 14px;border-radius:6px;cursor:pointer;font-weight:600;font-size:12px;">Bulk Progress Update</button></div>
    <div class="mn-add">
      <select id="mnSel"><option value="">Add an admin…</option>${candidates.map(uid=>`<option value="${uid}">${displayNames[uid]||uid}</option>`).join('')}</select>
      <button class="mn-add-btn" onclick="mnAdd()">Add</button>
    </div>
    <div class="mn-list">${rows||'<div class="mn-empty">No admins yet.</div>'}</div>`;
  document.getElementById('bulkBtn')?.addEventListener('click',showBulkUpdateSection);
}
async function mnAdd(){
  const uid=document.getElementById('mnSel').value;
  if(!uid)return;
  await addMentor(uid);
  renderMentors();
}
async function mnRemove(uid){
  await removeMentor(uid);
  renderMentors();
}

// ═══════════════════════════════════════════════════════
// BULK PROGRESS UPDATE
// ═══════════════════════════════════════════════════════
let bulkState={currentStep:1,selectedUsers:[],selectedTree:'',selectedSubtree:'',selectedSkills:[],selectedStatus:'complete'};
let bulkSearchCooldown=false;

function showBulkUpdateSection(){
  const section=document.getElementById('bulkUpdateSection');
  if(!section){console.error('bulkUpdateSection not found');return;}
  section.style.display='block';
  const btn=document.getElementById('bulkBtn');
  if(btn)btn.style.display='none';
  bulkState={currentStep:1,selectedUsers:[],selectedTree:'',selectedSubtree:'',selectedSkills:[],selectedStatus:'complete'};
  bulkRenderStep();

  // Attach event listeners to inputs
  const pinInput=document.getElementById('bulkPinInput');
  if(pinInput)pinInput.addEventListener('input',()=>{if(pinInput.value.length===3)bulkAddByPin();});

  const searchInput=document.getElementById('bulkUserSearch');
  if(searchInput)searchInput.addEventListener('input',bulkSearchUsers);

  // Attach event listeners to buttons
  document.querySelectorAll('.bulk-next-btn').forEach(btn=>btn.addEventListener('click',bulkNextStep));
  document.querySelectorAll('.bulk-back-btn').forEach(btn=>btn.addEventListener('click',bulkPrevStep));
  document.querySelectorAll('.bulk-apply-btn').forEach(btn=>btn.addEventListener('click',bulkApply));

  // Close button - find button with ✕ symbol
  const btns=section.querySelectorAll('button');
  for(let b of btns){
    if(b.textContent.includes('✕')){
      b.addEventListener('click',closeBulkUpdateSection);
      b.removeAttribute('onclick');
    }
  }
}

function closeBulkUpdateSection(){
  const section=document.getElementById('bulkUpdateSection');
  if(section)section.style.display='none';
  const btn=document.getElementById('bulkBtn');
  if(btn)btn.style.display='block';
}

function bulkRenderStep(){
  console.log('bulkRenderStep called, rendering step:',bulkState.currentStep);
  document.querySelectorAll('.step').forEach(s=>s.classList.remove('active'));
  const step=document.getElementById('bulkStep'+bulkState.currentStep);
  console.log('Step element:',step);
  if(step)step.classList.add('active');
  else console.error('Step element not found: bulkStep'+bulkState.currentStep);
  if(bulkState.currentStep===1)bulkRenderUserStep();
  else if(bulkState.currentStep===2)bulkRenderSkillStep();
  else if(bulkState.currentStep===3)bulkRenderReviewStep();
  const section=document.getElementById('bulkUpdateSection');
  if(section)section.scrollIntoView({behavior:'smooth'});
}

function bulkRenderUserStep(){
  const div=document.getElementById('bulkSelectedUsers');
  div.innerHTML=bulkState.selectedUsers.length?bulkState.selectedUsers.map(u=>`<div class="bulk-user-tag" data-uid="${u.id}">${u.displayName}<button class="bulk-remove-user">×</button></div>`).join(''):'';

  // Attach remove listeners
  div.querySelectorAll('.bulk-remove-user').forEach((btn,idx)=>{
    btn.addEventListener('click',()=>bulkRemoveUser(bulkState.selectedUsers[idx].id));
  });
}

async function bulkAddByPin(){
  const pin=document.getElementById('bulkPinInput').value.trim();
  if(pin.length!==3)return;
  console.log('Looking up PIN:',pin,'API:',G3ID_API);
  try{
    const url=`${G3ID_API}/users/by-pin/${pin}`;
    console.log('Fetching:',url);
    const res=await fetch(url,{credentials:'include'});
    console.log('Response status:',res.status);
    if(!res.ok){
      const err=await res.text();
      throw new Error(`HTTP ${res.status}: ${err}`);
    }
    const user=await res.json();
    console.log('Found user:',user);
    if(!bulkState.selectedUsers.find(u=>u.id===user.id)){
      bulkState.selectedUsers.push({id:user.id,displayName:user.displayName});
      bulkRenderUserStep();
    }
    document.getElementById('bulkPinInput').value='';
  }catch(e){
    console.error('PIN lookup error:',e);
    alert('Error: '+e.message);
  }
}

function bulkSearchUsers(){
  const query=document.getElementById('bulkUserSearch').value.toLowerCase();
  const resultsDiv=document.getElementById('bulkUserSearchResults');
  if(!query){resultsDiv.style.display='none';return;}
  console.log('Searching for:',query,'in',Object.keys(displayNames).length,'students');
  const results=Object.entries(displayNames).filter(([,name])=>name.toLowerCase().includes(query)).slice(0,5);
  console.log('Found:',results.length,'results');

  // Auto-add if exactly 1 result
  if(results.length===1){
    const [uid,name]=results[0];
    bulkAddUserFromSearch(uid,name);
    return;
  }

  const html=results.map(([uid,name])=>`<button>${name}</button>`).join('');
  resultsDiv.innerHTML=html;
  resultsDiv.style.display=html?'block':'none';

  // Attach click handlers to result buttons
  resultsDiv.querySelectorAll('button').forEach((btn,idx)=>{
    const [uid,name]=results[idx];
    btn.addEventListener('click',()=>bulkAddUserFromSearch(uid,name));
  });
}

function bulkAddUserFromSearch(uid,name){
  if(!bulkState.selectedUsers.find(u=>u.id===uid)){
    bulkState.selectedUsers.push({id:uid,displayName:name});
    bulkRenderUserStep();

    // Show visual feedback
    const resultDiv=document.getElementById('bulkUserSearchResults');
    const originalBg=resultDiv.style.backgroundColor;
    resultDiv.style.backgroundColor='#d4edda';
    resultDiv.style.transition='background-color 0.3s ease';

    // Cooldown
    bulkSearchCooldown=true;
    setTimeout(()=>{bulkSearchCooldown=false;},750);
  }
  document.getElementById('bulkUserSearch').value='';
  document.getElementById('bulkUserSearchResults').style.display='none';
}

function bulkRemoveUser(uid){
  bulkState.selectedUsers=bulkState.selectedUsers.filter(u=>u.id!==uid);
  bulkRenderUserStep();
}

function bulkBuildTreeSelect(){
  const sel=document.getElementById('bulkTreeSelect');sel.innerHTML='<option value="">Choose a tree...</option>';
  TREES.forEach(t=>{const o=document.createElement('option');o.value=t.id;o.textContent=t.icon+' '+t.name;sel.appendChild(o);});
}

function bulkRenderSkillStep(){
  console.log('bulkRenderSkillStep called');
  bulkRenderTreeSelect();
  bulkRenderSelectedSkills();
  document.getElementById('bulkSkillSelectorGroup').style.display='block';
  document.getElementById('bulkSelectedSkillsGroup').style.display='block';
}

function bulkRenderTreeSelect(){
  const sel=document.getElementById('bulkTreeSelect');
  sel.innerHTML='<option value="">Choose a tree...</option>';
  TREES.forEach(t=>{const o=document.createElement('option');o.value=t.id;o.textContent=t.icon+' '+t.name;sel.appendChild(o);});
  sel.addEventListener('change',bulkOnTreeChange);
}

function bulkOnTreeChange(){
  const treeId=document.getElementById('bulkTreeSelect').value;
  const subtreeSel=document.getElementById('bulkSubtreeSelect');
  const skillSel=document.getElementById('bulkSkillSelect');
  skillSel.innerHTML='<option value="">Choose a skill...</option>';
  if(!treeId){subtreeSel.innerHTML='<option value="">Choose a category...</option>';return;}
  const tree=TREES.find(t=>t.id===treeId);
  subtreeSel.innerHTML='<option value="">Choose a category...</option>';
  (tree.cats||[]).forEach(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=c.name;subtreeSel.appendChild(o);});
  subtreeSel.addEventListener('change',bulkOnSubtreeChange);
}

function bulkOnSubtreeChange(){
  const treeId=document.getElementById('bulkTreeSelect').value;
  const catId=document.getElementById('bulkSubtreeSelect').value;
  const skillSel=document.getElementById('bulkSkillSelect');
  skillSel.innerHTML='<option value="">Choose a skill...</option>';
  if(!treeId || !catId)return;
  const tree=TREES.find(t=>t.id===treeId);
  const skills=tree.nodes.filter(n=>n.cat===catId);
  skills.forEach(sk=>{const o=document.createElement('option');o.value=sk.id;o.textContent=sk.label;skillSel.appendChild(o);});
  skillSel.addEventListener('change',bulkOnSkillChange);
}

function bulkOnSkillChange(){
  const treeId=document.getElementById('bulkTreeSelect').value;
  const skillId=document.getElementById('bulkSkillSelect').value;
  if(!treeId || !skillId)return;
  const tree=TREES.find(t=>t.id===treeId);
  const skill=tree.nodes.find(s=>s.id===skillId);
  const cat=tree.cats.find(c=>c.id===skill.cat);
  const label=`${tree.name} > ${cat.name} > ${skill.label}`;
  if(!bulkState.selectedSkills.find(s=>s.id===skillId)){
    bulkState.selectedSkills.push({id:skillId,label,treeId});
    bulkRenderSelectedSkills();
    document.getElementById('bulkSkillSelect').value='';
    bulkRenderSkillOptions();
  }
}

function bulkRenderSkillOptions(){
  const treeId=document.getElementById('bulkTreeSelect').value;
  const catId=document.getElementById('bulkSubtreeSelect').value;
  const skillSel=document.getElementById('bulkSkillSelect');
  skillSel.innerHTML='<option value="">Choose a skill...</option>';
  if(!treeId || !catId)return;
  const tree=TREES.find(t=>t.id===treeId);
  const skills=tree.nodes.filter(n=>n.cat===catId);
  skills.forEach(sk=>{const o=document.createElement('option');o.value=sk.id;o.textContent=sk.label;skillSel.appendChild(o);});
}

function bulkRenderSelectedSkills(){
  const div=document.getElementById('bulkSelectedSkillsList');
  if(!bulkState.selectedSkills.length){
    div.innerHTML='<div style="color:#999;padding:8px;">No skills selected</div>';
    return;
  }
  div.innerHTML=bulkState.selectedSkills.map((s,i)=>`<div style="padding:8px;background:#e8f4f8;border:1px solid #90caf9;border-radius:4px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;color:#000;"><span style="flex:1;color:#000;">${s.label}</span><button onclick="bulkRemoveSkill(${i})" style="background:none;border:none;cursor:pointer;font-size:18px;color:#666;padding:0;margin-left:8px;flex-shrink:0;">×</button></div>`).join('');
}

function bulkRemoveSkill(idx){
  bulkState.selectedSkills.splice(idx,1);
  bulkRenderSelectedSkills();
}

function bulkRenderReviewStep(){
  const statusText=bulkState.selectedStatus.charAt(0).toUpperCase()+bulkState.selectedStatus.slice(1);
  const userLines=bulkState.selectedUsers.map(u=>`<div>${u.displayName}</div>`).join('');
  document.getElementById('bulkReviewContent').innerHTML=`<div><strong>Users (${bulkState.selectedUsers.length}):</strong></div>${userLines}<div style="margin-top:10px;"><strong>Skills (${bulkState.selectedSkills.length}):</strong></div>${bulkState.selectedSkills.map(s=>`<div>• ${s.label}</div>`).join('')}<div style="margin-top:10px;"><strong>Status:</strong> ${statusText}</div>`;
}

function bulkNextStep(){
  console.log('bulkNextStep called, current step:',bulkState.currentStep);
  if(bulkState.currentStep===1){
    if(!bulkState.selectedUsers.length){alert('Please select at least one user');return;}
    bulkState.currentStep=2;
  }else if(bulkState.currentStep===2){
    bulkState.selectedStatus=document.getElementById('bulkStatusSelect').value;
    if(!bulkState.selectedSkills.length){alert('Please select at least one skill');return;}
    bulkState.currentStep=3;
  }
  bulkRenderStep();
}

function bulkPrevStep(){
  if(bulkState.currentStep>1)bulkState.currentStep--;
  bulkRenderStep();
}

async function bulkApply(){
  const btn=event.target;btn.disabled=true;btn.textContent='Applying...';
  try{
    let success=0;
    for(const user of bulkState.selectedUsers){
      for(const skill of bulkState.selectedSkills){
        const res=await fetch(`${SKILL_TREE_API}/students/${user.id}`,{
          method:'PATCH',
          headers:{'Content-Type':'application/json'},
          credentials:'include',
          body:JSON.stringify({skillId:skill.id,status:bulkState.selectedStatus})
        });
        if(res.ok)success++;
      }
    }
    alert(`Updated ${success}/${bulkState.selectedUsers.length*bulkState.selectedSkills.length} skill updates`);
    bulkState.currentStep=1;
    bulkState.selectedTree='';
    bulkState.selectedSubtree='';
    bulkState.selectedSkills=[];
    bulkState.selectedStatus='complete';
    bulkRenderStep();
  }catch(e){
    alert('Error applying updates: '+e.message);
  }finally{
    btn.disabled=false;
    btn.textContent='Apply to All Users';
  }
}

// ── Tree selector (mobile) ─────────────────────────────
function buildTreeSel(){
  const s=document.getElementById('treeSel');s.innerHTML='';
  TREES.forEach(t=>{const o=document.createElement('option');o.value=t.id;o.textContent=t.icon+' '+t.name;if(t.id===curTree)o.selected=true;s.appendChild(o);});
}
function onTreeSel(){curTree=document.getElementById('treeSel').value;if(view==='tr')renderTrees();}

// ── Student selector ───────────────────────────────────
function renderSel(){
  const s=document.getElementById('ssel');s.innerHTML='';
  const byName=(a,b)=>(displayNames[a]||a).localeCompare(displayNames[b]||b);
  Object.keys(students).sort(byName).forEach(uid=>{const o=document.createElement('option');o.value=uid;o.textContent=displayNames[uid]||uid;if(uid===cur)o.selected=true;s.appendChild(o);});
}
document.getElementById('ssel').addEventListener('change',e=>{cur=e.target.value;closePanel();if(view==='ov')renderOv();else renderTrees();});

// ═══════════════════════════════════════════════════════
// OVERVIEW RENDER
// ═══════════════════════════════════════════════════════
const TC=TREES.map(t=>t.color);

function renderOv(){
  renderSel();buildTreeSel();
  const grid=document.getElementById('ovGrid');grid.innerHTML='';
  TREES.forEach((tree,ti)=>{
    const color=tree.color;
    const byName=(a,b)=>(displayNames[a]||a).localeCompare(displayNames[b]||b);
    const sdata=Object.keys(students).sort(byName).map(uid=>{
      const tot=tree.nodes.length;
      const done=tree.nodes.filter(n=>((students[uid]||{})[n.id]||'not-started')==='complete').length;
      return{name:displayNames[uid]||uid,done,tot,pct:tot?Math.round(done/tot*100):0};
    });
    const avgDone=sdata.length?Math.round(sdata.reduce((a,s)=>a+s.done,0)/sdata.length):0;
    const avgPct=tree.nodes.length?Math.round(avgDone/tree.nodes.length*100):0;
    const card=document.createElement('div');card.className='ov-card';
    card.onclick=()=>{curTree=tree.id;go('tr');};
    card.innerHTML=`
      <div class="ov-head"><div class="ov-icon">${tree.icon}</div><div><div class="ov-name">${tree.name}</div><div class="ov-count">${tree.nodes.length} skills</div></div></div>
      <div class="ov-bar-bg"><div class="ov-bar-fill" style="width:${avgPct}%;background:${color}"></div></div>
      <div class="ov-stats"><span>Team avg</span><span class="d">${avgDone}/${tree.nodes.length}</span></div>
      <div class="ov-rows">${sdata.map(s=>`<div class="ov-row"><div class="ov-sn">${s.name}</div><div class="ov-sb"><div class="ov-sf" style="width:${s.pct}%;background:${color};opacity:0.7"></div></div><div class="ov-sp">${s.pct}%</div></div>`).join('')}</div>
    `;
    grid.appendChild(card);
  });
  const allN=TREES.reduce((a,t)=>a+t.nodes.length,0);
  const byName=(a,b)=>(displayNames[a]||a).localeCompare(displayNames[b]||b);
  const rows=Object.keys(students).sort(byName).map(uid=>{
    const done=TREES.reduce((a,t)=>a+t.nodes.filter(n=>((students[uid]||{})[n.id]||'not-started')==='complete').length,0);
    const prog=TREES.reduce((a,t)=>a+t.nodes.filter(n=>((students[uid]||{})[n.id]||'not-started')==='in-progress').length,0);
    return{name:displayNames[uid]||uid,done,prog,pct:allN?Math.round(done/allN*100):0};
  });
  document.getElementById('sumWrap').innerHTML=`
    <table class="sum-table">
      <thead><tr><th>Student</th><th>Complete</th><th>In Progress</th><th>Overall</th></tr></thead>
      <tbody>${rows.map(r=>`<tr>
        <td class="td-nm">${r.name}</td><td class="td-dn">${r.done}</td><td class="td-pr">${r.prog}</td>
        <td><div class="td-br"><div class="td-bb"><div class="td-bf" style="width:${r.pct}%;background:var(--done-b)"></div></div><div class="td-bp">${r.pct}%</div></div></td>
      </tr>`).join('')}</tbody>
    </table>`;
}

// ═══════════════════════════════════════════════════════
// TREE RENDER
// Desktop: safety (horizontal) → gate banner → 8 trees in a scrollable row.
// Mobile:  single curTree only.
// ═══════════════════════════════════════════════════════
function isNarrow(){return window.innerWidth<700;}

function renderTrees(){
  renderSel();buildTreeSel();

  // Preserve scroll position so a Firestore update doesn't jump the view
  const treeArea=document.getElementById('treeArea');
  const scrollTop=treeArea.scrollTop,scrollLeft=treeArea.scrollLeft;

  const narrow=isNarrow();

  // Scale layout constants 1.5× on desktop, 1× on mobile.
  {const _s=narrow?1:1.5;
   NW=Math.round(164*_s);NH=Math.round(72*_s);CG=Math.round(44*_s);
   LANE_H=Math.round(20*_s);STUB=Math.round(24*_s);CHAN_CLEAR=Math.round(8*_s);
   LANE_W=Math.round(10*_s);RG_MIN=Math.round(48*_s);RC=Math.round(18*_s);}

  const c=document.getElementById('treesC');c.innerHTML='';
  const sc=sdone();
  const banner=document.createElement('div');
  banner.className='gate'+(sc?' ok':'');
  banner.innerHTML=sc?'✦ &nbsp;Safety complete — all trees unlocked.':'🔒 &nbsp;Complete the Safety tree (100%) to unlock all other skill trees.';

  // Show the selected discipline as a tree of category boxes.
  c.appendChild(banner);
  c.style.width='';
  const tree=TREES.find(t=>t.id===curTree);
  if(tree){
    const hdr=document.createElement('div');hdr.className='t-hdr';
    const{t,d}=tprog(tree);
    hdr.innerHTML=`<div class="t-icon">${tree.icon}</div><div><div class="t-name">${tree.name}</div><div class="t-sub">${tree.subtitle}</div></div><div class="t-pill"><span class="d">${d}</span> / ${t}</div>`;
    c.appendChild(hdr);

    // Category pseudo-nodes (a small tree of categories).
    const cats=tree.cats||[];
    const items=cats.map(cat=>{
      const ns=catNodesOf(tree,cat.id);
      const done=ns.filter(n=>gst(n.id)==='complete').length;
      return {id:cat.id,label:cat.name,sub:`${done} / ${ns.length} skills`,prereqs:cat.prereqs||[]};
    });
    const stateMap={};cats.forEach(cat=>stateMap[cat.id]=catDsp(tree,cat));
    const canvas=buildCanvas(items,{
      stateOf:id=>stateMap[id],
      onClick:item=>openSubtree(tree,item.id),
      dataAttr:'catId',
      extraClass:'cat-node',
    });
    const holder=document.createElement('div');holder.className='cat-tree';
    holder.appendChild(canvas);
    c.appendChild(holder);
  }

  // If a sub-tree overlay is open, keep it in sync after a data update.
  if(openTree)renderSubtree();

  // Restore scroll after DOM rebuild
  treeArea.scrollTop=scrollTop;treeArea.scrollLeft=scrollLeft;
}

// Generic canvas builder — lays out `items` (each {id,label,sub,prereqs}) and
// renders boxes + geometric edges. `opt` supplies state lookup, click handler,
// the dataset attribute name, and optional convergence/selection styling.
function buildCanvas(items,opt){
  const SVGNS='http://www.w3.org/2000/svg';
  const{pos,rank,cw,ch,gapHeights,rankY,gapColorings,gapSegs,chanXMap}=layout(items);
  const ids=new Set(items.map(n=>n.id));
  const edgeLayouts=buildEdgeLayout(items,pos,rank,gapHeights,rankY,gapColorings,gapSegs,chanXMap);
  const wrap=document.createElement('div');wrap.className='canvas-wrap';
  wrap.style.width=cw+'px';wrap.style.height=(ch+16)+'px';
  const svg=document.createElementNS(SVGNS,'svg');
  svg.setAttribute('width',cw);svg.setAttribute('height',ch+16);svg.classList.add('tree-svg');
  items.forEach(node=>{
    node.prereqs.forEach(pid=>{
      if(!ids.has(pid)||!pos[pid]||!pos[node.id])return;
      const fds=opt.stateOf(pid);
      const path=document.createElementNS(SVGNS,'path');
      path.setAttribute('d',edgePath(pos,rank,cw,pid,node.id,items,edgeLayouts));path.dataset.srcId=pid;
      let cls='edge ';
      cls+=fds==='complete'?'ec':fds==='in-progress'?'ep':fds==='available'?'ea':'el';
      if(opt.convOf&&opt.convOf(node))cls+=' edash';
      path.setAttribute('class',cls);svg.appendChild(path);
    });
  });
  wrap.appendChild(svg);
  const nl=document.createElement('div');nl.className='nodes-layer';
  nl.style.cssText=`position:relative;width:${cw}px;height:${ch+16}px;`;
  items.forEach(node=>{
    const p=pos[node.id];if(!p)return;
    const ds=opt.stateOf(node.id);
    const isSel=opt.selId&&opt.selId===node.id;
    const el=document.createElement('div');
    el.className=`node ${ds}${opt.convOf&&opt.convOf(node)?' convergence':''}${isSel?' sel':''}${opt.extraClass?' '+opt.extraClass:''}`;
    el.dataset[opt.dataAttr]=node.id;
    el.style.cssText=`left:${p.x}px;top:${p.y}px;width:${NW}px;min-height:${NH}px;`;
    const icon=ds==='locked'?'<div class="n-lock">🔒</div>':'<div class="n-dot"></div>';
    el.innerHTML=`<div class="n-top"><div class="n-label">${node.label}</div>${icon}</div><div class="n-sub">${node.sub||''}</div>`;
    el.addEventListener('click',()=>opt.onClick(node));
    nl.appendChild(el);
  });
  wrap.appendChild(nl);
  return wrap;
}

// ── SUB-TREE OVERLAY ────────────────────────────────────
function openSubtree(tree,catId){
  openTree=tree;openCat=catId;
  renderSubtree();
  document.getElementById('subtreeOverlay').classList.add('open');
  document.getElementById('subtreeBackdrop').classList.add('open');
  document.body.classList.add('subtree-open');
}
function renderSubtree(){
  if(!openTree||!openCat)return;
  const tree=openTree;
  const cat=(tree.cats||[]).find(c=>c.id===openCat);
  if(!cat)return;
  document.getElementById('subtreeTitle').innerHTML=`<span class="st-tag">${tree.icon} ${tree.name}</span><span class="st-name">${cat.name}</span>`;
  const host=document.getElementById('subtreeCanvas');host.innerHTML='';
  const catNodes=catNodesOf(tree,cat.id);
  const canvas=buildCanvas(catNodes,{
    stateOf:id=>{const f=findN(id);return f?dsp(f.node,tree):'locked';},
    convOf:n=>!!n.convergence,
    onClick:n=>openPanel(n,tree),
    dataAttr:'nodeId',
    selId:selNode&&selNode.id,
  });
  host.appendChild(canvas);
}
function closeSubtree(){
  document.getElementById('subtreeOverlay').classList.remove('open');
  document.getElementById('subtreeBackdrop').classList.remove('open');
  document.body.classList.remove('subtree-open');
  openTree=null;openCat=null;
  closePanel();
  renderTrees(); // refresh category boxes (progress / unlocks) underneath
}

// ═══════════════════════════════════════════════════════
// PANEL
// ═══════════════════════════════════════════════════════
function toggleDropdown(id) {
  const content = document.getElementById(id + 'Content');
  if (content) {
    content.classList.toggle('open');
    const header = content.previousElementSibling;
    if (header) header.classList.toggle('open');
  }
}

function openPanel(node,tree){
  selNode=node;selTree=tree;
  const ds=dsp(node,tree),raw=gst(node.id);
  document.getElementById('pTag').textContent=tree.icon+'  '+tree.name.toUpperCase();
  document.getElementById('pTitle').textContent=node.label;
  document.getElementById('pDesc').textContent=node.desc;
  const badge=document.getElementById('pBadge');badge.className='sbadge '+ds;
  document.getElementById('pSt').textContent={locked:'Locked',available:'Available','in-progress':'In Progress',complete:'Complete'}[ds];

  // Open the Description and Update Progress sections by default
  ['descContent','updateContent'].forEach(id => {
    const content = document.getElementById(id);
    const header = content ? content.previousElementSibling : null;
    if (content && header) { content.classList.add('open'); header.classList.add('open'); }
  });

  const psec=document.getElementById('pPreSec'),plist=document.getElementById('pPre');plist.innerHTML='';
  if(!node.prereqs.length){psec.style.display='none';}else{
    psec.style.display='block';
    node.prereqs.forEach(pid=>{const f=findN(pid);if(!f)return;const ps=gst(pid);const cls=ps==='complete'?'done':ps==='in-progress'?'prog':'none';const it=document.createElement('div');it.className='pr-item '+cls;it.innerHTML=`<div class="pr-dot"></div>${f.node.label}`;plist.appendChild(it);});
  }

  // Show Update Progress section only for mentors
  const updateSec = document.getElementById('pUpdateSec');
  if (updateSec) updateSec.style.display = userRole === 'mentor' ? '' : 'none';

  const locked=ds==='locked';
  ['bNS','bIP','bC'].forEach(id=>{document.getElementById(id).disabled=locked;document.getElementById(id).classList.remove('act');});
  if(!locked){document.getElementById(raw==='not-started'?'bNS':raw==='in-progress'?'bIP':'bC').classList.add('act');}
  document.getElementById('pFoot').textContent=node.convergence?'◈ Convergence node — all prerequisites must be complete to unlock.':'';
  document.getElementById('panel').classList.add('open');
  document.getElementById('panelOverlay').classList.add('open');
  document.body.classList.add('detail-open');
  document.querySelectorAll('.node.sel').forEach(el=>el.classList.remove('sel'));
  const selEl=document.querySelector('[data-node-id="'+node.id+'"]');
  if(selEl)selEl.classList.add('sel');
}
function closePanel(){
  selNode=null;selTree=null;
  document.getElementById('panel').classList.remove('open');
  document.getElementById('panelOverlay').classList.remove('open');
  document.body.classList.remove('detail-open');
  document.querySelectorAll('.node.sel').forEach(el=>el.classList.remove('sel'));
  // Reset all sections to collapsed
  document.querySelectorAll('.sec-content').forEach(el=>el.classList.remove('open'));
  document.querySelectorAll('.sec-header').forEach(el=>el.classList.remove('open'));
}
function setSt(s){
  if(!selNode||userRole!=='mentor')return;
  if(!students[cur])students[cur]={};
  students[cur][selNode.id]=s;
  // Refresh node visual states without full re-render (preserves scroll)
  document.querySelectorAll('.node[data-node-id]').forEach(el=>{
    const nid=el.dataset.nodeId;
    const found=findN(nid);
    if(!found)return;
    const ds=dsp(found.node,found.tree);
    const isSel=selNode&&selNode.id===nid;
    const wasLocked=el.classList.contains('locked');
    el.className='node '+ds+(found.node.convergence?' convergence':'')+(isSel?' sel':'');
    const lock=el.querySelector('.n-lock');
    if(lock)lock.style.display=ds==='locked'?'':'none';
    // If node just became unlocked, add click handler
    if(wasLocked&&ds!=='locked'){
      el.addEventListener('click',()=>openPanel(found.node,found.tree));
    }
  });
  // Refresh edge colors to match updated source node states
  document.querySelectorAll('path.edge[data-src-id]').forEach(path=>{
    const srcId=path.dataset.srcId;
    const found=findN(srcId);
    if(!found)return;
    const fds=dsp(found.node,found.tree);
    const isDash=path.classList.contains('edash');
    let cls='edge ';
    if(fds==='complete')cls+='ec';
    else if(fds==='in-progress')cls+='ep';
    else if(fds==='available')cls+='ea';
    else cls+='el';
    if(isDash)cls+=' edash';
    path.setAttribute('class',cls);
  });
  openPanel(selNode,selTree);
  // Persist to Firestore (optimistic — UI already updated above)
  saveSkill(selNode.id, s);
}

// Resize: re-render trees to switch between single/all-tree mode
(()=>{
  let lastW=window.innerWidth;
  window.addEventListener('resize',()=>{
    const w=window.innerWidth;
    if(w!==lastW){lastW=w;if(view==='tr')renderTrees();}
    // Ignore height-only changes (mobile browser chrome show/hide)
  });
})();

// ═══════════════════════════════════════════════════════
// EXPOSE FUNCTIONS TO WINDOW
// (Required because this file is an ES module — inline onclick
//  attributes in index.html need globally accessible functions.)
// ═══════════════════════════════════════════════════════
Object.assign(window, {
  go, onTreeSel, closePanel, setSt, doLogin, doLogout, mnAdd, mnRemove, toggleDropdown,
  closeSubtree,
});
