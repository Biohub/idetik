import {
  Color,
  ColorLike,
  Idetik,
  ImageLayer,
  LabelLayer,
  Layer,
  OmeZarrImageSource,
  OrthographicCamera,
  PanZoomControls,
  PointsRenderable,
  Viewport,
} from "idetik";
import GUI from "lil-gui";

// Molecular Cartography of a mouse liver section: a DAPI image, a nucleus
// segmentation, and 1.15 million transcripts across 100 genes, each a single
// detected molecule.

const DATA_URL =
  "https://data.idetik.org/examples/mouse-liver-molecular-cartography";

const [dapi, nuclei] = await Promise.all(
  ["dapi", "labels"].map((name) =>
    OmeZarrImageSource.fromHttp({
      url: `${DATA_URL}/${name}.ome.zarr`,
      version: "0.5",
    })
  )
);

// transcripts.bin holds uint16 (x, y) pixel pairs grouped by gene;
// transcripts.json gives each gene's offset and count into it.
type GeneIndex = {
  pixelSize: number;
  genes: { name: string; count: number; offset: number }[];
};
const [index, xy] = await Promise.all([
  fetch(`${DATA_URL}/transcripts.json`).then(
    (r) => r.json() as Promise<GeneIndex>
  ),
  fetch(`${DATA_URL}/transcripts.bin`)
    .then((r) => r.arrayBuffer())
    .then((b) => new Uint16Array(b)),
]);

class Transcripts extends Layer {
  public readonly type = "Transcripts";

  constructor(gene: string, color: ColorLike, size: number) {
    super();
    const { offset, count } = index.genes.find((g) => g.name === gene)!;
    const points = [];
    for (let i = offset; i < offset + count; i++) {
      points.push({
        position: [
          xy[2 * i] * index.pixelSize,
          xy[2 * i + 1] * index.pixelSize,
          0,
        ] as [number, number, number],
        color,
        size,
        marker: "circle" as const,
      });
    }
    this.addObject(new PointsRenderable(points));
    this.setState("ready");
  }

  public update(): boolean {
    return false;
  }
}

const image = new ImageLayer({
  source: dapi,
  sliceCoords: {},
  channelProps: [{ color: Color.WHITE, contrastLimits: [100, 6500] }],
});
const labels = new LabelLayer({
  source: nuclei,
  sliceCoords: {},
  opacity: 0.3,
  blendMode: "normal",
  outlineSelected: true,
});

const { x, y } = dapi.getDimensions();
const [xLod, yLod] = [x.lods[0], y.lods[0]];
const centerX = xLod.translation + 0.5 * xLod.size * xLod.scale;
const centerY = yLod.translation + 0.52 * yLod.size * yLod.scale;
const halfSize = 0.09 * yLod.size * yLod.scale;
const camera = new OrthographicCamera({
  left: centerX - halfSize,
  right: centerX + halfSize,
  top: centerY - halfSize,
  bottom: centerY + halfSize,
});
const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const viewport = new Viewport({
  domElement: canvas,
  camera,
  cameraControls: new PanZoomControls(camera),
  layers: [image, labels],
});
new Idetik({ canvas, viewports: [viewport] }).start();

// Markers of the liver lobule's zones and its resident macrophages, drawn
// in this order so the rarer genes sit on top.
const genes = [
  { name: "Pck1", note: "periportal", color: "#3fc8ff" },
  { name: "Cyp2e1", note: "pericentral", color: "#ff3fb4" },
  { name: "Glul", note: "central vein", color: "#ffd23f" },
  { name: "Clec4f", note: "Kupffer cells", color: "#7dff3f" },
];
const settings = {
  nuclei: true,
  pointSize: 2,
  ...Object.fromEntries(genes.map((g) => [g.name, true])),
} as Record<string, boolean | number>;

let cache = new Map<string, Transcripts>();
const hideGenes = () => {
  for (const layer of cache.values()) {
    if (viewport.layers.includes(layer)) viewport.removeLayer(layer);
  }
};
const updateGenes = () => {
  hideGenes();
  for (const { name, color } of genes) {
    if (!settings[name]) continue;
    if (!cache.has(name)) {
      cache.set(
        name,
        new Transcripts(name, color, settings.pointSize as number)
      );
    }
    viewport.addLayer(cache.get(name)!);
  }
};
updateGenes();

const gui = new GUI({ width: 280 }).close();
gui
  .add(settings, "nuclei")
  .onChange((on: boolean) => (labels.opacity = on ? 0.3 : 0));
gui
  .add(settings, "pointSize", 1, 10, 1)
  .name("point size")
  .onFinishChange(() => {
    hideGenes();
    cache = new Map();
    updateGenes();
  });
const folder = gui.addFolder("genes");
for (const { name, note } of genes) {
  folder.add(settings, name).name(`${name} (${note})`).onChange(updateGenes);
}
