// Lays boxes out as a top-down tree and routes the lines between them: each box sits one row
// below the deepest thing it requires, rows are packed and centered, and lines that share a gap
// between rows each get their own track so they never run on top of each other.

export type GraphItem = { id: number; prereqs: number[] };

export type Metrics = {
  nodeWidth: number;
  nodeHeight: number;
  columnGap: number;
  /** Vertical distance between two lines' tracks in the same gap. */
  laneHeight: number;
  /** How far a line runs straight out of (or into) a box before turning. */
  stub: number;
  /** How far a vertical line keeps from the side of a box it passes. */
  channelClear: number;
  laneWidth: number;
  minRowGap: number;
  cornerRadius: number;
};

/** The sizes at `scale`: 1 on phones, 1.5 on wider screens. */
export function metricsFor(scale: number): Metrics {
  const at = (n: number) => Math.round(n * scale);
  return {
    nodeWidth: at(164),
    nodeHeight: at(72),
    columnGap: at(44),
    laneHeight: at(20),
    stub: at(24),
    channelClear: at(8),
    laneWidth: at(10),
    minRowGap: at(48),
    cornerRadius: at(18),
  };
}

type Point = { x: number; y: number };

export type GraphLayout = {
  positions: Map<number, Point>;
  width: number;
  height: number;
  /** One SVG path per prerequisite, from the required box down to the one requiring it. */
  edges: { from: number; to: number; path: string }[];
};

/** A horizontal run of a line inside the gap below a row. */
type Segment = {
  key: string;
  /** "jog": a line between neighboring rows. "dep" / "arr": where a longer line leaves and lands. */
  type: "jog" | "dep" | "arr";
  xL: number;
  xR: number;
  chanX: number;
  srcId: number;
  dstId: number;
  x1: number;
  x2: number;
};

type Coloring = { trackCount: number; trackOf: Record<string, number> };

/** Gives every segment in a gap a track, so overlapping ones are stacked; departures above arrivals. */
function colorGap(segments: Segment[]): Coloring {
  if (segments.length === 0) return { trackCount: 0, trackOf: {} };
  const departures = segments.filter((s) => s.type !== "arr");
  const arrivals = segments.filter((s) => s.type === "arr");

  // Farthest-reaching first, so lines fan out without crossing.
  const orderedDepartures = [
    ...departures.filter((s) => s.chanX < s.x1).sort((a, b) => a.chanX - b.chanX),
    ...departures.filter((s) => s.chanX >= s.x1).sort((a, b) => b.chanX - a.chanX),
  ];
  const orderedArrivals = [
    ...arrivals.filter((s) => s.chanX >= s.x2).sort((a, b) => a.chanX - b.chanX),
    ...arrivals.filter((s) => s.chanX < s.x2).sort((a, b) => b.chanX - a.chanX),
  ];

  // Each segment takes the lowest track whose last segment ends before it starts.
  const trackOf: Record<string, number> = {};
  const place = (ordered: Segment[], trackEnd: number[], firstTrack: number) => {
    for (const s of ordered) {
      let t = firstTrack;
      while (t < trackEnd.length && trackEnd[t] > s.xL + 1) t++;
      while (trackEnd.length <= t) trackEnd.push(0);
      trackEnd[t] = s.xR;
      trackOf[`${s.key}:${s.type}`] = t;
    }
  };
  place(orderedDepartures, [], 0);
  const departureTracks = orderedDepartures.map((s) => trackOf[`${s.key}:${s.type}`]);
  const firstArrivalTrack = departureTracks.length > 0 ? Math.max(...departureTracks) + 1 : 0;
  place(
    orderedArrivals,
    new Array<number>(firstArrivalTrack).fill(Number.POSITIVE_INFINITY),
    firstArrivalTrack,
  );

  const tracks = Object.values(trackOf);
  return { trackCount: tracks.length > 0 ? Math.max(...tracks) + 1 : 0, trackOf };
}

export function layoutGraph(items: GraphItem[], metrics: Metrics): GraphLayout {
  const {
    nodeWidth: NW,
    nodeHeight: NH,
    columnGap: CG,
    laneHeight: LANE_H,
    stub: STUB,
    channelClear: CHAN_CLEAR,
    laneWidth: LANE_W,
    minRowGap: RG_MIN,
    cornerRadius: RC,
  } = metrics;

  const ids = new Set(items.map((item) => item.id));
  const nodes = items.map((item) => ({
    id: item.id,
    prereqs: item.prereqs.filter((id) => ids.has(id) && id !== item.id),
  }));
  if (nodes.length === 0) return { positions: new Map(), width: 0, height: 0, edges: [] };

  // 1. Rows: one below the deepest prerequisite. (The cap only matters if prerequisites loop,
  //    which the server refuses to save.)
  const rank: Record<number, number> = {};
  for (const n of nodes) rank[n.id] = 0;
  for (let pass = 0, changed = true; changed && pass <= nodes.length; pass++) {
    changed = false;
    for (const n of nodes) {
      for (const pid of n.prereqs) {
        if (rank[pid] + 1 > rank[n.id]) {
          rank[n.id] = rank[pid] + 1;
          changed = true;
        }
      }
    }
  }
  const maxRank = Math.max(...nodes.map((n) => rank[n.id]));
  const byRank: (typeof nodes)[] = Array.from({ length: maxRank + 1 }, () => []);
  for (const n of nodes) byRank[rank[n.id]].push(n);

  // 2. Pack each row, ordered by where its prerequisites sit so boxes land under them, then
  //    center every row on a common axis.
  const pos: Record<number, Point> = {};
  for (const row of byRank) {
    const under = (n: (typeof nodes)[number]) =>
      n.prereqs.length > 0
        ? n.prereqs.reduce((sum, pid) => sum + pos[pid].x, 0) / n.prereqs.length
        : 0;
    const ordered = [...row].sort((a, b) => under(a) - under(b));
    for (const [i, n] of ordered.entries()) pos[n.id] = { x: i * (NW + CG), y: 0 };
  }
  const rowWidth = (row: typeof nodes) => (row.length - 1) * (NW + CG);
  const maxWidth = Math.max(...byRank.map(rowWidth));
  for (const row of byRank) {
    const offset = (maxWidth - rowWidth(row)) / 2;
    for (const n of row) pos[n.id].x = Math.round(pos[n.id].x + offset);
  }
  const width = Math.max(...nodes.map((n) => pos[n.id].x)) + NW;

  // 3. Every line that isn't straight down gets a vertical channel: halfway between its ends,
  //    nudged sideways until it clears the boxes and other boxes' center lines on the way.
  const chanXOf: Record<string, number> = {};
  for (const n of nodes) {
    for (const pid of n.prereqs) {
      const x1 = pos[pid].x + NW / 2;
      const x2 = pos[n.id].x + NW / 2;
      if (Math.abs(x1 - x2) < 2) continue;
      const blocked: [number, number][] = [];
      for (const m of nodes) {
        const r = rank[m.id];
        const p = pos[m.id];
        if (r > rank[pid] && r < rank[n.id])
          blocked.push([p.x - CHAN_CLEAR, p.x + NW + CHAN_CLEAR]);
        if (r >= rank[pid] && r <= rank[n.id]) {
          const cx = p.x + NW / 2;
          blocked.push([cx - LANE_W * 2, cx + LANE_W * 2]);
        }
      }
      const clear = (x: number) => !blocked.some(([a, b]) => x > a && x < b);
      const nominal = (x1 + x2) / 2;
      let chanX = nominal;
      if (!clear(nominal)) {
        for (let d = LANE_W; d < width; d += LANE_W) {
          if (clear(nominal - d)) {
            chanX = nominal - d;
            break;
          }
          if (clear(nominal + d)) {
            chanX = nominal + d;
            break;
          }
        }
      }
      chanXOf[`${pid}->${n.id}`] = chanX;
    }
  }

  // 4. The horizontal runs in the gap below each row, and a track for each.
  const gapSegments: Segment[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (const n of nodes) {
    for (const pid of n.prereqs) {
      const x1 = pos[pid].x + NW / 2;
      const x2 = pos[n.id].x + NW / 2;
      const key = `${pid}->${n.id}`;
      const chanX = Math.abs(x1 - x2) < 2 ? x1 : chanXOf[key];
      const run = { key, chanX, srcId: pid, dstId: n.id, x1, x2 };
      const leaving = { ...run, xL: Math.min(x1, chanX), xR: Math.max(x1, chanX) };
      if (rank[n.id] - rank[pid] === 1) {
        gapSegments[rank[pid]].push({ ...leaving, type: "jog" });
      } else {
        gapSegments[rank[pid]].push({ ...leaving, type: "dep" });
        gapSegments[rank[n.id] - 1].push({
          ...run,
          type: "arr",
          xL: Math.min(chanX, x2),
          xR: Math.max(chanX, x2),
        });
      }
    }
  }
  const colorings = gapSegments.map(colorGap);

  // 5. Gaps are as tall as their tracks need; rows are placed from those.
  const gapHeights = colorings.map(({ trackCount }) =>
    Math.max(RG_MIN, 2 * STUB + Math.max(0, trackCount - 1) * LANE_H + LANE_H),
  );
  const rowY = [0];
  for (let r = 1; r <= maxRank; r++) rowY[r] = rowY[r - 1] + NH + gapHeights[r - 1];
  for (const n of nodes) pos[n.id].y = rowY[rank[n.id]];

  // 6. Where each line turns: its track's height, as an offset from the default turn.
  const turns: Record<string, { depart: number; arrive: number }> = {};
  gapSegments.forEach((segments, g) => {
    const { trackCount, trackOf } = colorings[g];
    const top = rowY[g] + NH + STUB;
    const usable = gapHeights[g] - 2 * STUB;
    for (const s of segments) {
      const track = trackOf[`${s.key}:${s.type}`];
      const y = trackCount <= 1 ? top + usable / 2 : top + track * (usable / (trackCount - 1));
      turns[s.key] ??= { depart: 0, arrive: 0 };
      if (s.type === "arr") turns[s.key].arrive = y - (pos[s.dstId].y - STUB);
      else turns[s.key].depart = y - (pos[s.srcId].y + NH + STUB);
    }
  });

  // 7. The lines themselves: straight down, or down / across / down with rounded corners (once
  //    between neighboring rows, twice through a channel for longer ones).
  const cap2 = (r: number, len: number) => Math.max(0, Math.min(r, (Math.abs(len) - 1) / 2));
  const cap1 = (r: number, len: number) => Math.max(0, Math.min(r, Math.abs(len) - 1));
  const edges: GraphLayout["edges"] = [];
  for (const n of nodes) {
    for (const pid of n.prereqs) {
      const key = `${pid}->${n.id}`;
      const x1 = pos[pid].x + NW / 2;
      const y1 = pos[pid].y + NH;
      const x2 = pos[n.id].x + NW / 2;
      const y2 = pos[n.id].y;
      const add = (path: string) => edges.push({ from: pid, to: n.id, path });
      if (Math.abs(x1 - x2) < 2) {
        add(`M${x1},${y1} L${x2},${y2}`);
        continue;
      }
      const chanX = chanXOf[key];
      const turn = turns[key] ?? { depart: 0, arrive: 0 };
      const sx1 = Math.sign(chanX - x1) || 1;
      const sx2 = Math.sign(x2 - chanX) || 1;

      if (rank[n.id] - rank[pid] === 1) {
        const yMid = y1 + STUB + turn.depart;
        const h = x2 - x1;
        const r1 = Math.min(cap1(RC, yMid - y1), cap2(RC, h));
        const r2 = Math.min(cap2(RC, h), cap1(RC, y2 - yMid));
        add(
          [
            `M${x1},${y1}`,
            `L${x1},${yMid - r1}`,
            `Q${x1},${yMid} ${x1 + sx1 * r1},${yMid}`,
            `L${x2 - sx2 * r2},${yMid}`,
            `Q${x2},${yMid} ${x2},${yMid + r2}`,
            `L${x2},${y2}`,
          ].join(" "),
        );
        continue;
      }

      const yDepart = y1 + STUB + turn.depart;
      const yArrive = y2 - STUB + turn.arrive;
      const h1 = chanX - x1;
      const v2 = yArrive - yDepart;
      const h2 = x2 - chanX;
      const r1 = Math.min(cap1(RC, yDepart - y1), cap2(RC, h1));
      const r2 = Math.min(cap2(RC, h1), cap2(RC, v2));
      const r3 = Math.min(cap2(RC, v2), cap2(RC, h2));
      const r4 = Math.min(cap2(RC, h2), cap1(RC, y2 - yArrive));
      add(
        [
          `M${x1},${y1}`,
          `L${x1},${yDepart - r1}`,
          `Q${x1},${yDepart} ${x1 + sx1 * r1},${yDepart}`,
          `L${chanX - sx1 * r2},${yDepart}`,
          `Q${chanX},${yDepart} ${chanX},${yDepart + r2}`,
          `L${chanX},${yArrive - r3}`,
          `Q${chanX},${yArrive} ${chanX + sx2 * r3},${yArrive}`,
          `L${x2 - sx2 * r4},${yArrive}`,
          `Q${x2},${yArrive} ${x2},${yArrive + r4}`,
          `L${x2},${y2}`,
        ].join(" "),
      );
    }
  }

  return {
    positions: new Map(nodes.map((n) => [n.id, pos[n.id]])),
    width,
    height: Math.max(...nodes.map((n) => pos[n.id].y)) + NH,
    edges,
  };
}
