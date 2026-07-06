/**
 * Sibling ref-point merge (D6(a), 2026-07-06).
 *
 * The recorded-session history can hold the SAME physical spot under two
 * ids ("visually duplicate, identity-distinct" definitions):
 *
 * - **durable neighbor twins** — two H3 cell ids in each other's gridDisk,
 *   both already persisted (the import gap-fill only guards NEW writes, it
 *   never merges two existing definitions);
 * - **legacy ids** — pre-H3 user-typed ids have no spatial identity, so the
 *   exact-id fallback can never match them to an H3 re-mark of the same
 *   spot.
 *
 * `mergeSiblingRefPoints` collapses such clusters IN MEMORY: it is applied
 * at load time (display + capture-matching consume merged definitions) and
 * to the recovery/import stream (clean imports persist one definition per
 * cluster). It never touches existing files.
 */

import {
  gpsToH3,
  h3CellsMatch,
  isH3Index,
  approxDistanceMetres,
} from 'gps-plus-slam-app-framework/geo/h3-proximity';
import {
  averageGpsPerRefPoint,
  type RefPointDefinition,
  type RefPointObservation,
} from './ref-point-loader';

/**
 * Maximum distance (m) between two definitions' AVERAGED positions for a
 * merge. Legitimate re-marks of one physical point sit within a few meters
 * of GPS jitter; distinct anchors are kept apart by design (H3 cells are
 * ~25 m edge, so same-cell/neighbor candidates can still be >10 m apart —
 * those must NOT merge). 10 m sits comfortably between the two regimes
 * observed in recorded-session data.
 */
export const SIBLING_MERGE_MAX_DIST_M = 10;

/** Content-based observation identity (D6(a) hardened dedupe key). */
function observationKey(obs: RefPointObservation): string {
  return `${obs.sessionId}|${obs.timestamp}|${obs.gpsPoint.latitude}|${obs.gpsPoint.longitude}`;
}

interface Member {
  readonly def: RefPointDefinition;
  /** Robust averaged position (accuracy-gated), null without observations. */
  readonly avg: { lat: number; lon: number } | null;
  /**
   * Spatial identity: the H3 id itself, or — for legacy ids — the cell
   * re-minted from the averaged position (decision: legacy re-mint happens
   * in memory; the on-disk file keeps its legacy id).
   */
  readonly effectiveCell: string | null;
}

function toMember(def: RefPointDefinition): Member {
  const avg = averageGpsPerRefPoint([def])[0] ?? null;
  const position = avg ? { lat: avg.lat, lon: avg.lon } : null;
  const effectiveCell = isH3Index(def.id)
    ? def.id
    : position
      ? gpsToH3(position.lat, position.lon)
      : null;
  return { def, avg: position, effectiveCell };
}

/** Same physical anchor? Same id always; otherwise neighbor cells AND close. */
function isSameAnchor(a: Member, b: Member): boolean {
  if (a.def.id === b.def.id) {
    return true;
  }
  if (!a.avg || !b.avg || !a.effectiveCell || !b.effectiveCell) {
    return false;
  }
  return (
    h3CellsMatch(a.effectiveCell, b.effectiveCell) &&
    approxDistanceMetres(a.avg.lat, a.avg.lon, b.avg.lat, b.avg.lon) <=
      SIBLING_MERGE_MAX_DIST_M
  );
}

/** Newest observation timestamp of a definition (0 when empty). */
function newestObservationTs(def: RefPointDefinition): number {
  return def.observations.reduce((max, o) => Math.max(max, o.timestamp), 0);
}

/**
 * Most-observations-wins name policy (D6(a) decision): the name backed by
 * the largest total observation count across the cluster's members wins;
 * ties go to the name with the newest backing observation. This makes one
 * throwaway rename in the newest recording lose against a long consistent
 * naming history — while a deliberate rename sticks once it accumulates
 * more observations.
 */
function resolveClusterName(members: Member[]): string {
  const byName = new Map<string, { obsCount: number; newestTs: number }>();
  for (const m of members) {
    const entry = byName.get(m.def.name) ?? { obsCount: 0, newestTs: 0 };
    entry.obsCount += m.def.observations.length;
    entry.newestTs = Math.max(entry.newestTs, newestObservationTs(m.def));
    byName.set(m.def.name, entry);
  }
  let winner = members[0]!.def.name;
  let best = { obsCount: -1, newestTs: -1 };
  for (const [name, entry] of byName) {
    if (
      entry.obsCount > best.obsCount ||
      (entry.obsCount === best.obsCount && entry.newestTs > best.newestTs)
    ) {
      winner = name;
      best = entry;
    }
  }
  return winner;
}

/** Merge one cluster into a single definition. */
function mergeCluster(members: Member[]): RefPointDefinition {
  // Primary member (id donor): most observations, ties → newest observation.
  const primary = members.reduce((best, m) => {
    const a = m.def.observations.length;
    const b = best.def.observations.length;
    if (a > b) return m;
    if (a === b && newestObservationTs(m.def) > newestObservationTs(best.def))
      return m;
    return best;
  });

  const seen = new Set<string>();
  const observations: RefPointObservation[] = [];
  for (const m of members) {
    for (const obs of m.def.observations) {
      const key = observationKey(obs);
      if (!seen.has(key)) {
        seen.add(key);
        observations.push(obs);
      }
    }
  }

  return {
    id: primary.effectiveCell ?? primary.def.id,
    name: resolveClusterName(members),
    createdAt: Math.min(...members.map((m) => m.def.createdAt)),
    observations,
  };
}

/** One clustering pass. Returns the merged list and whether anything changed. */
function mergeOnce(defs: RefPointDefinition[]): {
  merged: RefPointDefinition[];
  changed: boolean;
} {
  const members = defs.map(toMember);

  // Union-find over member indices.
  const parent = members.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      if (isSameAnchor(members[i]!, members[j]!)) {
        union(i, j);
      }
    }
  }

  const clusters = new Map<number, Member[]>();
  for (let i = 0; i < members.length; i++) {
    const root = find(i);
    const list = clusters.get(root) ?? [];
    list.push(members[i]!);
    clusters.set(root, list);
  }

  let changed = false;
  const merged: RefPointDefinition[] = [];
  for (const clusterMembers of clusters.values()) {
    if (clusterMembers.length === 1) {
      const only = clusterMembers[0]!;
      // Singleton legacy defs still get their in-memory H3 re-mint so the
      // proximity matcher can spatially match them.
      if (only.effectiveCell && only.effectiveCell !== only.def.id) {
        merged.push({ ...only.def, id: only.effectiveCell });
        changed = true;
      } else {
        merged.push(only.def);
      }
      continue;
    }
    merged.push(mergeCluster(clusterMembers));
    changed = true;
  }
  return { merged, changed };
}

/**
 * Collapse sibling clusters (same physical anchor stored under multiple
 * ids/definitions) into one definition each.
 *
 * - Cluster rule: same id, OR effective cells match (`h3CellsMatch`) AND
 *   the robust averaged positions are ≤ {@link SIBLING_MERGE_MAX_DIST_M}
 *   apart. Legacy ids participate via their re-minted cell.
 * - Merged definition: id = primary member's effective cell (most
 *   observations), name via most-observations-wins, earliest `createdAt`,
 *   observations unioned and deduped by content key.
 * - Runs to a fixpoint so the result is idempotent (a merge can move an
 *   averaged position and expose a further merge).
 * - Pure: never mutates the input; never touches storage.
 */
export function mergeSiblingRefPoints(
  defs: RefPointDefinition[]
): RefPointDefinition[] {
  let current = defs;
  // Each effective pass strictly reduces the definition count (or only
  // re-mints legacy ids once), so the fixpoint terminates quickly; the
  // guard is a safety net, not an expected limit.
  for (let pass = 0; pass < 20; pass++) {
    const { merged, changed } = mergeOnce(current);
    current = merged;
    if (!changed) break;
  }
  return current;
}
