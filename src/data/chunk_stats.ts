import { ChunkSource } from "./chunk";
import type { ChunkStore } from "./chunk_store";
import type { ChunkStoreView } from "./chunk_store_view";

/**
 * A snapshot of chunk demand and GPU residency.
 *
 * Requested counts include prefetch. When the memory limit cannot hold every
 * requested chunk, some are never fetched and `resident` stays below
 * `requested`.
 */
export type ChunkStats = {
  /** Cache state per source. */
  sources: readonly SourceChunkStats[];
  /** Loading progress per viewport. Viewports without chunked layers are omitted. */
  viewports: readonly ViewportChunkStats[];
};

/** Cache state for one source, combined across all of its views. */
export type SourceChunkStats = {
  /** The source the counts describe. */
  source: ChunkSource;
  /**
   * Chunks requested by any view, visible or prefetch, at any LOD. A chunk
   * requested by several views counts once. The budget may defer fetching.
   */
  requested: number;
  /** How many of `requested` are on the GPU and drawable. */
  resident: number;
  /**
   * The same counts by timepoint index, the position along the source's time
   * axis rather than the world `t` coordinate. A timepoint is fully loaded for
   * every view of the source when its two counts are equal.
   */
  timepoints: {
    /** `requested[t]` is the chunks requested at timepoint index `t`. */
    requested: Uint32Array;
    /** `resident[t]` is how many of `requested[t]` are on the GPU. */
    resident: Uint32Array;
  };
};

/** Loading progress for one viewport, summed across its chunked layers. */
export type ViewportChunkStats = {
  /** The viewport the counts describe. */
  viewportId: string;
  /**
   * Visible and prefetch chunks at any LOD, including the fallback LOD
   * drawn while the current one loads.
   */
  requested: number;
  /** How many of `requested` are on the GPU. */
  resident: number;
  /**
   * The same counts excluding fallback and prefetch: chunks visible at each
   * layer's current LOD and timepoint. The viewport is fully drawn at its
   * selected LOD when these are equal.
   */
  current: {
    /** Chunks visible at each layer's current LOD and timepoint. */
    requested: number;
    /** How many of `requested` are on the GPU. */
    resident: number;
  };
};

/**
 * Counts one source's chunks across all of its views.
 *
 * @param source - The source the store holds.
 * @param store - The store to count.
 */
export function computeSourceChunkStats(
  source: ChunkSource,
  store: ChunkStore
): SourceChunkStats {
  const numTimepoints = store.dimensions.t?.lods[0].size ?? 1;
  const timepoints = {
    requested: new Uint32Array(numTimepoints),
    resident: new Uint32Array(numTimepoints),
  };

  let requested = 0;
  let resident = 0;

  for (const key of store.demand.keys()) {
    const t = store.indicesOfKey(key).t;
    requested += 1;
    timepoints.requested[t] += 1;
    if (store.getEntry(key)?.texture !== undefined) {
      resident += 1;
      timepoints.resident[t] += 1;
    }
  }

  return { source, requested, resident, timepoints };
}

/**
 * Sums the chunks requested by a viewport's views.
 *
 * @param viewportId - The viewport the views render into.
 * @param views - The viewport's views, each with the store it views.
 */
export function computeViewportChunkStats(
  viewportId: string,
  views: readonly { view: ChunkStoreView; store: ChunkStore }[]
): ViewportChunkStats {
  let requested = 0;
  let resident = 0;
  const current = { requested: 0, resident: 0 };

  for (const { view, store } of views) {
    const currentLOD = view.currentLOD;
    for (const [key, state] of view.chunkViewStates) {
      const isResident = store.getEntry(key)?.texture !== undefined;
      requested += 1;
      if (isResident) resident += 1;

      // only the current timepoint is marked visible, so this skips temporal
      // prefetch as well as spatial prefetch and fallback
      if (!state.visible || store.lodOfKey(key) !== currentLOD) continue;
      current.requested += 1;
      if (isResident) current.resident += 1;
    }
  }

  return { viewportId, requested, resident, current };
}
