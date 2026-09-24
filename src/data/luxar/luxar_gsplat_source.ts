import { vec3 } from "gl-matrix";

import { Box3 } from "../../math/box3";
import { Logger } from "../../utilities/logger";
import type {
  GaussianSplatBlock,
  GaussianSplatSlice,
  GaussianSplatSliceDimension,
  GaussianSplatSource,
} from "../gaussian_splat_source";
import type { SliceGate } from "./decode";
import type { LuxarArrayRef } from "./worker";
import { LuxarWorkerPool } from "./worker_pool";

type Attributes = Record<string, unknown>;

type NodeMetadata = {
  node_type: "group" | "array";
  attributes?: Attributes;
  [key: string]: unknown;
};

type Bounds = { min: number[]; max: number[] };

type LuxarDimension = {
  name: string;
  range?: [number, number];
  step?: number | null;
  display?: boolean;
  discrete?: boolean;
};

type Rung = {
  path: string;
  count: number;
  arrays: {
    centers: LuxarArrayRef;
    amplitudes: LuxarArrayRef;
    choleskyDiag: LuxarArrayRef;
    choleskyOffdiag: LuxarArrayRef | null;
  };
};

type Leaf = {
  path: string;
  ndim: number;
  bounds: Bounds | undefined;
  rungs: Rung[];
};

/**
 * Display parameters authored in a Luxar store. Values are taken from the
 * shallowest node on the path to the first splat leaf that sets them.
 */
export type LuxarGSplatRenderDefaults = {
  blendingMode?: string;
  opacity?: number;
  absorption?: number;
  intensity?: number;
  offset?: number;
  gamma?: number;
  colormap?: string;
  truncationRadius?: number;
  amplitudeRange?: [number, number];
};

/**
 * Initialization properties for {@link LuxarGSplatSource.fromHttp}.
 */
export type HttpLuxarGSplatSourceProps = {
  /** URL of a `.luxar.zarr` scene or `.gsplats.zarr` store. */
  url: string;
  /** Number of decode workers. Defaults to 4. */
  workerCount?: number;
};

const ARRAY_NAMES = [
  "centers",
  "amplitudes",
  "cholesky_factors_diag",
  "cholesky_factors_offdiag",
] as const;

/**
 * Gaussian splats read from a Luxar zarr store.
 *
 * Supports scene (`.luxar.zarr`) and standalone (`.gsplats.zarr`) stores
 * written in the gsplats v3.1+ format with consolidated metadata. Every
 * gsplats node in the store is read. Additive ladders load coarsest level
 * first, and partition parts are selected by their bounds along the
 * non-displayed dimensions. Substitutive LOD groups render their finest
 * level. Per-splat colors are ignored; splats are colored by amplitude.
 *
 * @see https://github.com/royerlab/luxar
 */
export class LuxarGSplatSource implements GaussianSplatSource {
  /** World-space bounds of the splat centers. */
  public readonly bounds: Box3;
  /** The non-displayed dimensions splats are sliced along. */
  public readonly sliceDimensions: GaussianSplatSliceDimension[];
  /** Display parameters authored in the store. */
  public readonly renderDefaults: LuxarGSplatRenderDefaults;
  /** The total number of splats in the store. */
  public readonly totalCount: number;

  private readonly url_: string;
  private readonly leaves_: Leaf[];
  private readonly worldColumns_: [number, number, number];
  private readonly hiddenColumns_: number[];
  private readonly pool_: LuxarWorkerPool;
  private readonly blockRequests_ = new Map<
    string,
    { rung: Rung; gates: SliceGate[] }
  >();

  private constructor(
    url: string,
    rootAttributes: Attributes,
    metadata: Record<string, NodeMetadata>,
    workerCount: number
  ) {
    this.url_ = url;
    this.pool_ = new LuxarWorkerPool(workerCount);

    const leafPaths: string[][] = [];
    const tree = new LuxarTree(rootAttributes, metadata);
    this.leaves_ = tree.collectLeaves("", [], leafPaths);
    if (this.leaves_.length === 0) {
      throw new Error(`No Gaussian splats found in ${url}`);
    }
    this.totalCount = this.leaves_.reduce(
      (sum, leaf) => sum + leaf.rungs.reduce((s, r) => s + r.count, 0),
      0
    );

    const ndim = this.leaves_[0].ndim;
    if (this.leaves_.some((leaf) => leaf.ndim !== ndim)) {
      throw new Error("Splat nodes with mixed dimensionality are unsupported");
    }
    const dims = parseDimensions(rootAttributes, ndim);
    const display = dims
      .map((dim, i) => ({ dim, i }))
      .filter(({ dim }) => dim.display !== false)
      .slice(0, 3);
    if (display.length !== 3) {
      throw new Error("Luxar splats need three displayed dimensions");
    }
    this.worldColumns_ = worldColumnsFor(display);
    const displayed = new Set(display.map(({ i }) => i));
    this.hiddenColumns_ = dims
      .map((_, i) => i)
      .filter((i) => !displayed.has(i));
    this.sliceDimensions = this.hiddenColumns_.map((i) => ({
      name: dims[i].name,
      range: dims[i].range ?? this.hiddenRange(i),
      step: dims[i].step ?? null,
      discrete: dims[i].discrete ?? false,
    }));

    const rootBounds = rootAttributes.position_bounds as Bounds | undefined;
    this.bounds = this.worldBounds(rootBounds);
    this.renderDefaults = tree.renderDefaults(leafPaths[0]);
  }

  /**
   * Opens a Luxar store over HTTP.
   *
   * @param props - The store URL and loader options.
   */
  public static async fromHttp({
    url,
    workerCount = 4,
  }: HttpLuxarGSplatSourceProps) {
    const base = url.replace(/\/+$/, "");
    const response = await fetch(`${base}/zarr.json`);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${base}/zarr.json: ${response.status} ${response.statusText}`
      );
    }
    const root = await response.json();
    const metadata = root.consolidated_metadata?.metadata;
    if (!metadata) {
      throw new Error(
        `${url} has no consolidated metadata; only zarr v3 Luxar stores are supported`
      );
    }
    return new LuxarGSplatSource(
      base,
      root.attributes ?? {},
      metadata,
      workerCount
    );
  }

  /** Terminates the decode workers. */
  public dispose() {
    this.pool_.terminate();
  }

  public getBlocks(slice: GaussianSplatSlice): GaussianSplatBlock[] {
    const gates = this.gates(slice);
    const visible = this.leaves_.filter((leaf) =>
      this.leafVisible(leaf, gates)
    );
    const maxRungs = Math.max(0, ...visible.map((leaf) => leaf.rungs.length));

    const blocks: GaussianSplatBlock[] = [];
    for (let r = 0; r < maxRungs; r++) {
      for (const leaf of visible) {
        const rung = leaf.rungs[r];
        if (!rung) continue;
        // Leaves selected by their bounds alone skip the per-splat gates and
        // can be shared between slices.
        const perSplat = this.needsPerSplatGates(leaf, gates);
        const key = perSplat
          ? `${rung.path}@${gates.map((g) => g.value).join(",")}`
          : rung.path;
        this.blockRequests_.set(key, { rung, gates: perSplat ? gates : [] });
        blocks.push({ key, count: rung.count });
      }
    }
    return blocks;
  }

  public loadBlock(block: GaussianSplatBlock) {
    const request = this.blockRequests_.get(block.key);
    if (!request) {
      throw new Error(`Unknown block ${block.key}`);
    }
    const { rung, gates } = request;
    return this.pool_.decode({
      url: this.url_,
      count: rung.count,
      ndim: this.leaves_[0].ndim,
      arrays: rung.arrays,
      options: { worldColumns: this.worldColumns_, gates },
    });
  }

  private gates(slice: GaussianSplatSlice): SliceGate[] {
    return this.hiddenColumns_.map((column, i) => {
      const dim = this.sliceDimensions[i];
      return {
        column,
        value: slice[dim.name] ?? dim.range[0],
        halfStep: dim.discrete ? (dim.step ?? 1) / 2 : null,
      };
    });
  }

  private leafVisible(leaf: Leaf, gates: SliceGate[]) {
    if (!leaf.bounds) return true;
    return gates.every((gate) => {
      if (gate.halfStep === null) return true;
      const min = leaf.bounds!.min[gate.column];
      const max = leaf.bounds!.max[gate.column];
      return (
        gate.value >= min - gate.halfStep && gate.value <= max + gate.halfStep
      );
    });
  }

  private needsPerSplatGates(leaf: Leaf, gates: SliceGate[]) {
    return gates.some((gate) => {
      if (gate.halfStep === null || !leaf.bounds) return true;
      const extent =
        leaf.bounds.max[gate.column] - leaf.bounds.min[gate.column];
      return extent > gate.halfStep;
    });
  }

  private hiddenRange(column: number): [number, number] {
    let min = Infinity;
    let max = -Infinity;
    for (const leaf of this.leaves_) {
      if (!leaf.bounds) continue;
      min = Math.min(min, leaf.bounds.min[column]);
      max = Math.max(max, leaf.bounds.max[column]);
    }
    return Number.isFinite(min) ? [min, max] : [0, 0];
  }

  private worldBounds(rootBounds: Bounds | undefined) {
    const boxes = rootBounds
      ? [rootBounds]
      : this.leaves_.flatMap((leaf) => (leaf.bounds ? [leaf.bounds] : []));
    const box = new Box3();
    const [cx, cy, cz] = this.worldColumns_;
    for (const b of boxes) {
      box.expandWithPoint(vec3.fromValues(b.min[cx], b.min[cy], b.min[cz]));
      box.expandWithPoint(vec3.fromValues(b.max[cx], b.max[cy], b.max[cz]));
    }
    return box;
  }
}

function parseDimensions(
  rootAttributes: Attributes,
  ndim: number
): LuxarDimension[] {
  const scene = rootAttributes.scene_dimensions as
    | { dimensions?: LuxarDimension[] }
    | undefined;
  const standalone = rootAttributes.dimension_metadata as
    | LuxarDimension[]
    | undefined;
  const dims = scene?.dimensions ?? standalone;
  if (dims && dims.length === ndim) return dims;
  if (dims) {
    Logger.warn(
      "LuxarGSplatSource",
      `Ignoring ${dims.length} dimensions for ${ndim}D splats`
    );
  }
  return Array.from({ length: ndim }, (_, i) => ({
    name: `dim_${i}`,
    display: i < 3,
  }));
}

// Maps displayed dimensions named x, y, and z to the matching world axes.
// Otherwise assumes array order (z, y, x).
function worldColumnsFor(
  display: { dim: LuxarDimension; i: number }[]
): [number, number, number] {
  const byName = ["x", "y", "z"].map(
    (axis) => display.find(({ dim }) => dim.name.toLowerCase() === axis)?.i
  );
  if (byName.every((i) => i !== undefined)) {
    return byName as [number, number, number];
  }
  return [display[2].i, display[1].i, display[0].i];
}

const CHILD_TYPES = new Set(["group", "gsplats", "scene"]);

class LuxarTree {
  private readonly children_ = new Map<string, string[]>();

  constructor(
    private readonly rootAttributes_: Attributes,
    private readonly metadata_: Record<string, NodeMetadata>
  ) {
    for (const path of Object.keys(metadata_).sort()) {
      const slash = path.lastIndexOf("/");
      const parent = slash === -1 ? "" : path.slice(0, slash);
      const siblings = this.children_.get(parent);
      if (siblings) {
        siblings.push(path);
      } else {
        this.children_.set(parent, [path]);
      }
    }
  }

  public collectLeaves(
    path: string,
    ancestors: string[],
    leafPaths: string[][]
  ): Leaf[] {
    const attributes = this.attributes(path);
    const lineage = [...ancestors, path];
    if (attributes.type === "gsplats") {
      leafPaths.push(lineage);
      return [this.leaf(path, attributes)];
    }
    if (!CHILD_TYPES.has(attributes.type as string)) return [];

    let children = (this.children_.get(path) ?? []).filter((child) =>
      CHILD_TYPES.has(this.attributes(child).type as string)
    );
    if (attributes.kind === "lod" && children.length > 0) {
      Logger.warn(
        "LuxarGSplatSource",
        `Rendering only the finest level of LOD group ${path}`
      );
      children = [this.finestChild(children)];
    }
    return children.flatMap((child) =>
      this.collectLeaves(child, lineage, leafPaths)
    );
  }

  public renderDefaults(lineage: string[]): LuxarGSplatRenderDefaults {
    const nodes = lineage.map((path) => this.attributes(path));
    const find = <T>(key: string) =>
      nodes.find((attrs) => attrs[key] !== undefined)?.[key] as T | undefined;
    return {
      blendingMode: find("blending_mode"),
      opacity: find("opacity"),
      absorption: find("absorption"),
      intensity: find("intensity"),
      offset: find("offset"),
      gamma: find("gamma"),
      colormap: find("colormap"),
      truncationRadius: find("truncation_radius"),
      amplitudeRange: find("amplitude_data_range"),
    };
  }

  private leaf(path: string, attributes: Attributes): Leaf {
    const nAdditive = (attributes.n_additive_sublods as number) ?? 0;
    const rungPaths =
      nAdditive > 0
        ? Array.from({ length: nAdditive }, (_, i) => `${path}/additive_${i}`)
        : [path];
    return {
      path,
      ndim: attributes.ndim as number,
      bounds: attributes.position_bounds as Bounds | undefined,
      rungs: rungPaths.map((rungPath) => this.rung(rungPath)),
    };
  }

  private rung(path: string): Rung {
    const refs = ARRAY_NAMES.map((name) => {
      const key = path ? `${path}/${name}` : name;
      const metadata = this.metadata_[key];
      return metadata?.node_type === "array"
        ? { path: `/${key}` as const, metadata }
        : null;
    });
    const [centers, amplitudes, choleskyDiag, choleskyOffdiag] = refs;
    if (!centers || !amplitudes || !choleskyDiag) {
      throw new Error(
        `Splat node ${path || "/"} is missing centers, amplitudes, or split Cholesky factors (gsplats v3.1+)`
      );
    }
    return {
      path,
      count: this.attributes(path).n_splats as number,
      arrays: { centers, amplitudes, choleskyDiag, choleskyOffdiag },
    };
  }

  private finestChild(children: string[]) {
    const index = (child: string) =>
      (this.attributes(child).child_index as number | undefined) ??
      Number(child.match(/(\d+)$/)?.[1] ?? 0);
    return children.reduce((a, b) => (index(b) > index(a) ? b : a));
  }

  private attributes(path: string): Attributes {
    if (path === "") return this.rootAttributes_;
    return this.metadata_[path]?.attributes ?? {};
  }
}
