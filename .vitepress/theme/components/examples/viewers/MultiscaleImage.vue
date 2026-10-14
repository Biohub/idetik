<script setup lang="ts">
import { ref, shallowReactive, shallowRef, watch } from "vue";
import type {
  ImageLayer,
  OrthographicCamera,
  SliceOrientation,
  SourceDimension,
  SourceDimensionMap,
} from "@idetik/core";
import SliceControls from "../SliceControls.vue";
import { useIdetikViewer } from "../useIdetikViewer";

type Axis = "x" | "y" | "z";

const PLANE_AXES: Record<SliceOrientation, [Axis, Axis]> = {
  XY: ["x", "y"],
  XZ: ["x", "z"],
  YZ: ["y", "z"],
};

const mode = ref<SliceOrientation | "T">("XY");
const dims = shallowRef<SourceDimensionMap | null>(null);
const sliceCoords = shallowReactive({ t: 400, x: 0, y: 0, z: 0, c: [0] });

let camera: OrthographicCamera | null = null;
let layer: ImageLayer | null = null;

function extentOf(dim: SourceDimension): [number, number] {
  const { translation, size, scale } = dim.lods[0];
  return [translation, translation + size * scale];
}

function frameFor(o: SliceOrientation) {
  const [u, v] = PLANE_AXES[o];
  const [left, right] = extentOf(dims.value![u]!);
  const [top, bottom] = extentOf(dims.value![v]!);
  return { left, right, top, bottom };
}

watch(mode, (m) => {
  if (m === "T" || !camera || !layer) return;
  camera.setOrientation(m);
  camera.setFrame(frameFor(m));
  layer.setOrientation(m);
});

const canvas = useIdetikViewer(
  async (
    {
      Color,
      Idetik,
      ImageLayer,
      OmeZarrImageSource,
      OrthographicCamera,
      PanZoomControls,
      Viewport,
      createExplorationPolicy,
    },
    target
  ) => {
    const baseUrl = "https://public.czbiohub.org/royerlab/zebrahub/imaging";
    const source = await OmeZarrImageSource.fromHttp({
      url: `${baseUrl}/single-objective/ZSNS001.ome.zarr/`,
    });

    dims.value = source.getDimensions();
    for (const axis of ["x", "y", "z"] as const) {
      const { translation, size, scale } = dims.value[axis]!.lods[0];
      sliceCoords[axis] = translation + Math.floor((size - 1) / 2) * scale;
    }

    camera = new OrthographicCamera({
      ...frameFor("XY"),
      orientation: "XY",
    });

    layer = new ImageLayer({
      source,
      sliceCoords,
      orientation: "XY",
      policy: createExplorationPolicy({ prefetch: { x: 1, y: 1, z: 0 } }),
      channelProps: [{ color: Color.WHITE, contrastLimits: [0, 60] }],
    });

    return new Idetik({
      canvas: target,
      viewports: [
        new Viewport({
          domElement: target,
          camera,
          cameraControls: new PanZoomControls(camera, {
            scrollZoom: "modifier",
          }),
          layers: [layer],
        }),
      ],
    });
  }
);
</script>

<template>
  <div>
    <canvas ref="canvas"></canvas>
    <SliceControls
      v-if="dims"
      v-model:mode="mode"
      :dims="dims"
      :slice-coords="sliceCoords"
    />
  </div>
</template>
