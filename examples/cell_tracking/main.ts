import { vec3, vec4 } from "gl-matrix";
import GUI from "lil-gui";
import {
  Color,
  EventContext,
  Idetik,
  ImageLayer,
  Layer,
  OmeZarrImageSource,
  OrbitControls,
  PerspectiveCamera,
  PointsRenderable,
  ProjectedLineGeometry,
  ProjectedLineRenderable,
  Viewport,
  createExplorationPolicy,
  createPlaybackPolicy,
} from "idetik";
import { addDimensionSlider } from "../lil_gui_utils";

// Nucleus tracks over a light-sheet timelapse of a zebrafish tail. Tracked
// nuclei near the current z-plane are drawn as points; clicking one selects
// its track and draws the path it has taken so far, plus the tracks of its
// ancestors. Nodes are fetched one timepoint at a time and a selected track
// is fetched with an HTTP range request, so the 7.5 million node table never
// loads in full.
const IMAGE_URL =
  "https://public.czbiohub.org/royerlab/zebrahub/imaging/single-objective/ZSNS001_tail.ome.zarr/";
const TRACKS_URL = "https://data.idetik.org/examples/zebrahub-tail-tracks";
const NODE_BYTES = 16;

const source = await OmeZarrImageSource.fromHttp({ url: IMAGE_URL });
const dimensions = source.getDimensions();
const xLod = dimensions.x.lods[0];
const yLod = dimensions.y.lods[0];
const zLod = dimensions.z!.lods[0];
const tLod = dimensions.t!.lods[0];
const midCoord = (lod: typeof zLod) =>
  lod.translation + Math.floor((lod.size - 1) / 2) * lod.scale;
const zExtent = Math.ceil(zLod.size * zLod.scale);

const sliceCoords = { c: [0], z: midCoord(zLod), t: 400 };

// nodes/{t}.bin holds every nucleus at one timepoint: x, y, z as float32
// and the track id as uint32, 16 bytes per node.
type Nodes = { positions: Float32Array; trackIds: Uint32Array; count: number };
const nodeCache = new Map<number, Promise<Nodes>>();
function fetchNodes(t: number): Promise<Nodes> {
  let nodes = nodeCache.get(t);
  if (!nodes) {
    const name = String(t).padStart(4, "0");
    nodes = fetch(`${TRACKS_URL}/nodes/${name}.bin`)
      .then((response) => response.arrayBuffer())
      .then((buffer) => ({
        positions: new Float32Array(buffer),
        trackIds: new Uint32Array(buffer),
        count: buffer.byteLength / NODE_BYTES,
      }));
    nodeCache.set(t, nodes);
    if (nodeCache.size > 64) {
      nodeCache.delete(nodeCache.keys().next().value!);
    }
  }
  return nodes;
}

// tracks_index.bin has node offset, node count and parent track id per
// track; tracks.bin has t, x, y, z per node sorted by track, so one track
// is a contiguous byte range.
const indexResponse = await fetch(`${TRACKS_URL}/tracks_index.bin`);
const trackIndex = new Uint32Array(await indexResponse.arrayBuffer());
type Track = { id: number; parent: number; nodes: Float32Array };
const trackCache = new Map<number, Promise<Track>>();
function fetchTrack(id: number): Promise<Track> {
  let track = trackCache.get(id);
  if (!track) {
    const [offset, count, parent] = trackIndex.subarray(id * 3, id * 3 + 3);
    const start = offset * NODE_BYTES;
    track = fetch(`${TRACKS_URL}/tracks.bin`, {
      headers: { Range: `bytes=${start}-${start + count * NODE_BYTES - 1}` },
    })
      .then((response) => response.arrayBuffer())
      .then((buffer) => ({ id, parent, nodes: new Float32Array(buffer) }));
    trackCache.set(id, track);
  }
  return track;
}

async function fetchLineage(id: number): Promise<Track[]> {
  const lineage: Track[] = [];
  for (let next = id; next !== 0; ) {
    const track = await fetchTrack(next);
    lineage.push(track);
    next = track.parent;
  }
  return lineage;
}

const NODE_COLOR = new Color(0.5, 0.9, 1.0, 0.7);
const SELECTED_COLOR = Color.YELLOW;
const LINEAGE_COLOR = new Color(1.0, 0.6, 0.2);

class TrackedNucleiLayer extends Layer {
  public readonly type = "TrackedNuclei";
  public zWindow = zExtent; // micrometers either side of the slice
  public smoothing = 2; // moving-average half-window in timepoints
  public onSelect?: (lineage: Track[] | null) => void;

  private viewport_?: Viewport;
  private nodes_?: Nodes;
  private nodesTime_ = -1;
  private sliceZ_ = NaN;
  private lineage_: Track[] | null = null;
  private pointerDown_?: [number, number];
  private dirty_ = true;

  constructor() {
    super({ blendMode: "normal", occludes: false });
    this.setState("initialized");
    this.setState("ready");
  }

  public refresh() {
    this.dirty_ = true;
  }

  /**
   * Where the selected nucleus is at the current timepoint, smoothed the
   * same way as its drawn path so the camera doesn't inherit the jitter.
   */
  public get selectedPosition(): vec3 | undefined {
    const track = this.lineage_?.[0];
    if (!track) return undefined;
    const count = this.nodesUpToNow(track);
    return this.smoothedNode(track.nodes, count, count - 1);
  }

  // Tracks have one node per timepoint, so the node for time t is at
  // index t - t0.
  private nodesUpToNow(track: Track): number {
    const count = track.nodes.length / 4;
    const index = Math.round(sliceCoords.t) - track.nodes[0];
    return Math.min(count, Math.max(1, index + 1));
  }

  public select(id: number | null) {
    if (id === null) {
      this.lineage_ = null;
      this.dirty_ = true;
      this.onSelect?.(null);
      return;
    }
    void fetchLineage(id).then((lineage) => {
      this.lineage_ = lineage;
      this.dirty_ = true;
      this.onSelect?.(lineage);
    });
  }

  public update(viewport?: Viewport): boolean {
    this.viewport_ = viewport;
    const t = Math.round(sliceCoords.t);
    if (t !== this.nodesTime_) {
      this.nodesTime_ = t;
      void fetchNodes(t).then((nodes) => {
        if (this.nodesTime_ !== t) return;
        this.nodes_ = nodes;
        this.dirty_ = true;
      });
      for (let ahead = 1; ahead <= 3; ++ahead) {
        if (t + ahead < tLod.size) void fetchNodes(t + ahead);
      }
    }
    if (sliceCoords.z !== this.sliceZ_) {
      this.sliceZ_ = sliceCoords.z;
      this.dirty_ = true;
    }
    if (!this.dirty_) return false;
    this.dirty_ = false;
    this.rebuild();
    return true;
  }

  public onEvent(event: EventContext) {
    const pointer = event.event as PointerEvent | undefined;
    if (!pointer || !this.viewport_) return;
    if (event.type === "pointerdown") {
      this.pointerDown_ = [pointer.clientX, pointer.clientY];
    } else if (event.type === "pointerup" && this.pointerDown_) {
      const [x0, y0] = this.pointerDown_;
      this.pointerDown_ = undefined;
      if (Math.hypot(pointer.clientX - x0, pointer.clientY - y0) > 4) return;
      this.pickAt(pointer.clientX, pointer.clientY);
    }
  }

  // Selects the nucleus nearest the click within an 8 px radius, preferring
  // ones close to the slice when several overlap.
  private pickAt(clientX: number, clientY: number) {
    const nodes = this.nodes_;
    const viewport = this.viewport_;
    if (!nodes || !viewport) return;
    const rect = viewport.domElement.getBoundingClientRect();
    const viewProjection = viewport.camera.getViewProjection();
    const clip = vec4.create();
    let best = -1;
    let bestDistance = 8;
    for (let i = 0; i < nodes.count; ++i) {
      const [x, y, z] = nodes.positions.subarray(i * 4, i * 4 + 3);
      const dz = Math.abs(z - sliceCoords.z);
      if (dz > this.zWindow) continue;
      vec4.transformMat4(clip, vec4.set(clip, x, y, z, 1), viewProjection);
      if (clip[3] <= 0) continue;
      const screenX = rect.x + ((clip[0] / clip[3] + 1) / 2) * rect.width;
      const screenY = rect.y + ((clip[1] / clip[3] + 1) / 2) * rect.height;
      const distance =
        Math.hypot(screenX - clientX, screenY - clientY) + 0.05 * dz;
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    }
    this.select(best >= 0 ? nodes.trackIds[best * 4 + 3] : null);
  }

  // Nuclei shrink with distance from the slice plane, levelling off at 30%
  // of full size about 30 µm away.
  private rebuild() {
    this.clearObjects();
    const nodes = this.nodes_;
    if (!nodes) return;
    const selected = this.lineage_?.[0].id;
    const points = [];
    for (let i = 0; i < nodes.count; ++i) {
      const [x, y, z] = nodes.positions.subarray(i * 4, i * 4 + 3);
      const dz = Math.abs(z - sliceCoords.z);
      if (dz > this.zWindow) continue;
      const isSelected = nodes.trackIds[i * 4 + 3] === selected;
      const falloff = Math.max(0.3, 1 - dz / 40);
      points.push({
        position: vec3.fromValues(x, y, z),
        color: isSelected ? SELECTED_COLOR : NODE_COLOR,
        size: (isSelected ? 18 : 9) * falloff,
        marker: "circle" as const,
      });
    }
    this.addObject(new PointsRenderable(points));

    if (!this.lineage_) return;
    this.lineage_.forEach((track, generation) => {
      // The selected track is drawn up to the current time; ancestors in full.
      const count =
        generation === 0 ? this.nodesUpToNow(track) : track.nodes.length / 4;
      const path = this.smoothedPath(track.nodes, count);
      // A daughter track begins where its parent ended, so join them there.
      const parent = this.lineage_![generation + 1];
      if (parent && count > 0) {
        const last = parent.nodes.length - 4;
        path.unshift(parent.nodes.subarray(last + 1, last + 4) as vec3);
      }
      if (path.length < 2) return;
      this.addObject(
        new ProjectedLineRenderable({
          geometry: new ProjectedLineGeometry(path),
          color: generation === 0 ? SELECTED_COLOR : LINEAGE_COLOR,
          width: generation === 0 ? 3 : 1.5,
        })
      );
    });
  }

  // Nucleus centroids jitter by about a pixel per frame, so the path is a
  // moving average over ±smoothing timepoints, using only the first `count`
  // nodes so the end of a trail isn't pulled toward the future.
  private smoothedPath(nodes: Float32Array, count: number): vec3[] {
    const path: vec3[] = [];
    for (let i = 0; i < count; ++i) {
      path.push(this.smoothedNode(nodes, count, i));
    }
    return path;
  }

  private smoothedNode(nodes: Float32Array, count: number, i: number): vec3 {
    const from = Math.max(0, i - this.smoothing);
    const to = Math.min(count - 1, i + this.smoothing);
    const sum = vec3.create();
    for (let j = from; j <= to; ++j) {
      vec3.add(sum, sum, nodes.subarray(j * 4 + 1, j * 4 + 4) as vec3);
    }
    return vec3.scale(sum, sum, 1 / (to - from + 1));
  }
}

const channelState = { contrastMax: 150 };
const explorationPolicy = createExplorationPolicy({
  prefetch: { x: 1, y: 1, z: 1, t: 2 },
});
// Tracks pass behind the slice plane constantly, so the image doesn't write
// depth; it blends additively, so black is see-through and the tracks show
// through the slice from either side.
const imageLayer = new ImageLayer({
  source,
  sliceCoords,
  policy: explorationPolicy,
  occludes: false,
  channelProps: [
    {
      visible: true,
      contrastLimits: [0, channelState.contrastMax],
      color: "#ffffff",
    },
  ],
});
const nucleiLayer = new TrackedNucleiLayer();

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const extent = (lod: typeof xLod) => lod.size * lod.scale;
const center = vec3.fromValues(
  xLod.translation + extent(xLod) / 2,
  yLod.translation + extent(yLod) / 2,
  zLod.translation + extent(zLod) / 2
);
const orbitRadius = 1.1 * Math.max(extent(xLod), extent(yLod));
const camera = new PerspectiveCamera({
  fov: 45,
  near: orbitRadius / 100,
  far: orbitRadius * 10,
});
const controls = new OrbitControls(camera, {
  radius: orbitRadius,
  yaw: 0.5,
  pitch: 0.7,
  target: center,
});
const viewport = new Viewport({
  domElement: canvas,
  camera,
  cameraControls: controls,
  layers: [imageLayer, nucleiLayer],
});

// Eases the orbit target and the z-slice toward the selected nucleus so the
// camera and the image plane follow it through time.
const follow = { enabled: true };
const followOverlay = {
  update() {
    const position = nucleiLayer.selectedPosition;
    if (!follow.enabled || !position) return;
    const target = controls.target;
    if (vec3.distance(target, position) < 0.01) return;
    controls.target = vec3.lerp(target, target, position, 0.15);
    sliceCoords.z += 0.15 * (position[2] - sliceCoords.z);
    zController.updateDisplay();
  },
};

const timePointDiv = document.querySelector<HTMLDivElement>("#time-point")!;
const timePointOverlay = {
  update() {
    const time = imageLayer.lastPresentationTimeCoord;
    timePointDiv.textContent = time === undefined ? "" : `t = ${time}`;
  },
};

const idetik = new Idetik({
  canvas,
  viewports: [viewport],
  overlays: [timePointOverlay, followOverlay],
});
idetik.start();

// The selected track is kept in the URL hash so a view can be shared.
const hashParams = new URLSearchParams(location.hash.slice(1));
function updateHash() {
  history.replaceState(null, "", `#${hashParams}`);
}
const selectionDiv = document.querySelector<HTMLDivElement>("#selection")!;
nucleiLayer.onSelect = (lineage) => {
  if (lineage) hashParams.set("track", String(lineage[0].id));
  else hashParams.delete("track");
  updateHash();
  if (!lineage) {
    selectionDiv.textContent = "Click a nucleus to follow its track";
    return;
  }
  const [track] = lineage;
  const first = track.nodes[0];
  const last = track.nodes[track.nodes.length - 4];
  selectionDiv.innerHTML =
    `<div class="label">Track ${track.id}</div>` +
    `<div class="meta">t ${first} – ${last} (${track.nodes.length / 4} nodes)\n` +
    `ancestors: ${lineage.length - 1}</div>`;
};
const initialTrack = Number(hashParams.get("track"));
nucleiLayer.select(initialTrack > 0 ? initialTrack : null);

const gui = new GUI({ width: 380 }).close();
const zController = addDimensionSlider({
  gui,
  sliceCoords,
  dimensionName: "z",
  lod: zLod,
});
addDimensionSlider({
  gui,
  sliceCoords,
  dimensionName: "t",
  lod: tLod,
  playback: {
    maxRateHz: 10,
    // The image is stored in 128-plane bricks that the layer slices on the
    // GPU, so a timepoint costs a whole brick: about 1 MB at the coarsest
    // level but 7 MB at the next and 33 MB per brick at full resolution.
    // Playback pins the coarsest level so frames arrive in time.
    onRateChange: (rateHz: number) => {
      imageLayer.imageSourcePolicy =
        rateHz > 0
          ? createPlaybackPolicy({ lod: { min: dimensions.numLods - 1 } })
          : explorationPolicy;
    },
  },
});
gui
  .add(nucleiLayer, "zWindow", 5, zExtent, 1)
  .name("Nuclei z-window (±µm from slice)")
  .onChange(() => nucleiLayer.refresh());
gui
  .add(nucleiLayer, "smoothing", 0, 10, 1)
  .name("Track smoothing (±timepoints)")
  .onChange(() => nucleiLayer.refresh());
gui.add(follow, "enabled").name("Follow selected nucleus");
gui
  .add({ clear: () => nucleiLayer.select(null) }, "clear")
  .name("Clear selection");

gui
  .add(channelState, "contrastMax", 20, 1000, 5)
  .name("Contrast max")
  .onChange((max: number) =>
    imageLayer.setChannelProps([
      { visible: true, contrastLimits: [0, max], color: "#ffffff" },
    ])
  );
