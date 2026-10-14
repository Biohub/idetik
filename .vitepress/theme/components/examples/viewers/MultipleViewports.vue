<script setup lang="ts">
import { ref, shallowReactive, shallowRef } from "vue";
import type {
  ChannelProps,
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

const xy = ref<HTMLDivElement | null>(null);
const view3D = ref<HTMLDivElement | null>(null);
const xz = ref<HTMLDivElement | null>(null);
const yz = ref<HTMLDivElement | null>(null);
const dims = shallowRef<SourceDimensionMap | null>(null);
const sliceCoords = shallowReactive({ t: 400, x: 0, y: 0, z: 0, c: [0] });
const active = ref<string | null>(null);

function extentOf(dim: SourceDimension): [number, number] {
  const { translation, size, scale } = dim.lods[0];
  return [translation, translation + size * scale];
}

const canvas = useIdetikViewer(
  async (
    {
      Color,
      Idetik,
      ImageLayer,
      OmeZarrImageSource,
      OrbitControls,
      OrthographicCamera,
      PanZoomControls,
      PerspectiveCamera,
      Viewport,
      VolumeLayer,
      createExplorationPolicy,
    },
    target
  ) => {
    const baseUrl = "https://public.czbiohub.org/royerlab/zebrahub/imaging";
    const source = await OmeZarrImageSource.fromHttp({
      url: `${baseUrl}/single-objective/ZSNS001.ome.zarr/`,
    });

    dims.value = source.getDimensions();
    const extents: Record<Axis, [number, number]> = {
      x: extentOf(dims.value.x),
      y: extentOf(dims.value.y),
      z: extentOf(dims.value.z!),
    };
    const center = (axis: Axis) => (extents[axis][0] + extents[axis][1]) / 2;
    const size = (axis: Axis) => extents[axis][1] - extents[axis][0];

    const channelProps: ChannelProps[] = [
      { color: Color.WHITE, contrastLimits: [0, 60] },
    ];
    for (const axis of ["x", "y", "z"] as const) {
      const { translation, size, scale } = dims.value[axis]!.lods[0];
      sliceCoords[axis] = translation + Math.floor((size - 1) / 2) * scale;
    }

    function sliceLayer(orientation: SliceOrientation) {
      return new ImageLayer({
        source,
        sliceCoords,
        orientation,
        policy: createExplorationPolicy(),
        channelProps,
      });
    }

    function sliceViewport(
      element: HTMLElement,
      orientation: SliceOrientation
    ) {
      const [u, v] = PLANE_AXES[orientation];
      const [left, right] = extents[u];
      const [top, bottom] = extents[v];
      const camera = new OrthographicCamera({
        left,
        right,
        top,
        bottom,
        orientation,
      });
      return new Viewport({
        id: orientation,
        domElement: element,
        camera,
        cameraControls: new PanZoomControls(camera, { scrollZoom: "modifier" }),
        layers: [sliceLayer(orientation)],
      });
    }

    const camera3D = new PerspectiveCamera();

    const volume = new VolumeLayer({
      source,
      sliceCoords,
      policy: createExplorationPolicy({ lod: { min: 2, max: 2 } }),
      channelProps,
    });
    volume.opacityMultiplier = 0.015;
    volume.relativeStepSize = 0.3;

    return new Idetik({
      canvas: target,
      viewports: [
        sliceViewport(xy.value!, "XY"),
        new Viewport({
          id: "3D",
          domElement: view3D.value!,
          camera: camera3D,
          cameraControls: new OrbitControls(camera3D, {
            radius: 0.85 * Math.hypot(size("x"), size("y"), size("z")),
            yaw: 0.6,
            pitch: 0.4,
            target: [center("x"), center("y"), center("z")],
            scrollZoom: "modifier",
            dampingFactor: 0.25,
          }),
          layers: [volume],
        }),
        sliceViewport(xz.value!, "XZ"),
        sliceViewport(yz.value!, "YZ"),
      ],
    });
  }
);
</script>

<template>
  <div class="multiple-viewports">
    <div class="scene">
      <canvas ref="canvas"></canvas>
      <div class="grid">
        <div
          ref="xy"
          class="viewport"
          :class="{ active: active === 'XY' }"
          @mouseenter="active = 'XY'"
        >
          <span class="label">
            <span class="axis-x">X</span><span class="axis-y">Y</span>
          </span>
        </div>
        <div
          ref="view3D"
          class="viewport"
          :class="{ active: active === '3D' }"
          @mouseenter="active = '3D'"
        ></div>
        <div
          ref="xz"
          class="viewport"
          :class="{ active: active === 'XZ' }"
          @mouseenter="active = 'XZ'"
        >
          <span class="label">
            <span class="axis-x">X</span><span class="axis-z">Z</span>
          </span>
        </div>
        <div
          ref="yz"
          class="viewport"
          :class="{ active: active === 'YZ' }"
          @mouseenter="active = 'YZ'"
        >
          <span class="label">
            <span class="axis-y">Y</span><span class="axis-z">Z</span>
          </span>
        </div>
      </div>
    </div>
    <SliceControls v-if="dims" :dims="dims" :slice-coords="sliceCoords" />
  </div>
</template>

<style scoped>
.multiple-viewports {
  background-color: #000;
}

.scene {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.grid {
  position: absolute;
  inset: 0;
  isolation: isolate;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
}

.viewport {
  position: relative;
  min-width: 0;
  min-height: 0;
  border: 1px solid #555;
}

.viewport:nth-child(2n) {
  margin-left: -1px;
}

.viewport:nth-child(n + 3) {
  margin-top: -1px;
}

.viewport.active {
  z-index: 1;
  border-color: #c4b5fd;
}

.label {
  position: absolute;
  bottom: 10px;
  left: 10px;
  font-size: 12px;
  font-weight: bold;
  letter-spacing: 2px;
  color: #888;
  pointer-events: none;
  user-select: none;
}
</style>
