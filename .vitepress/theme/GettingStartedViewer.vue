<script setup lang="ts">
import {
  onBeforeUnmount,
  onMounted,
  ref,
  shallowReactive,
  shallowRef,
} from "vue";
import type { Idetik, SourceDimension } from "@idetik/core";
import RangeSlider from "./RangeSlider.vue";

type Range = { min: number; max: number; step: number };

const canvas = ref<HTMLCanvasElement | null>(null);
const error = ref<string | null>(null);
const ranges = shallowRef<{ z: Range; t: Range } | null>(null);
const sliceCoords = shallowReactive({ t: 400, z: 278, c: [0] });

let idetik: Idetik | null = null;
let unmounted = false;

function rangeOf(dim: SourceDimension): Range {
  const { translation, size, scale } = dim.lods[0];
  return {
    min: translation,
    max: translation + (size - 1) * scale,
    step: scale,
  };
}

onMounted(async () => {
  const target = canvas.value;
  if (!target) return;
  try {
    const {
      Idetik,
      ImageLayer,
      OmeZarrImageSource,
      OrthographicCamera,
      PanZoomControls,
      Viewport,
    } = await import("@idetik/core");

    const baseUrl = "https://public.czbiohub.org/royerlab/zebrahub/imaging";
    const source = await OmeZarrImageSource.fromHttp({
      url: `${baseUrl}/single-objective/ZSNS001.ome.zarr/`,
    });

    if (unmounted) return;

    const dims = source.getDimensions();
    const x = dims.x.lods[0];
    const y = dims.y.lods[0];

    const camera = new OrthographicCamera({
      left: x.translation,
      right: x.translation + x.size * x.scale,
      top: y.translation,
      bottom: y.translation + y.size * y.scale,
    });

    const layer = new ImageLayer({
      source,
      sliceCoords,
      channelProps: [{ contrastLimits: [0, 60] }],
    });

    idetik = new Idetik({
      canvas: target,
      viewports: [
        new Viewport({
          domElement: target,
          camera,
          cameraControls: new PanZoomControls(camera),
          layers: [layer],
        }),
      ],
    }).start();

    ranges.value = { z: rangeOf(dims.z!), t: rangeOf(dims.t!) };
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
});

onBeforeUnmount(() => {
  unmounted = true;
  idetik?.stop();
  canvas.value
    ?.getContext("webgl2")
    ?.getExtension("WEBGL_lose_context")
    ?.loseContext();
});
</script>

<template>
  <div class="viewer">
    <div class="viewer-canvas">
      <canvas ref="canvas"></canvas>
      <p v-if="error" class="viewer-error">{{ error }}</p>
    </div>
    <div v-if="ranges" class="viewer-controls">
      <RangeSlider
        v-model="sliceCoords.z"
        label="z"
        unit="µm"
        v-bind="ranges.z"
      />
      <RangeSlider v-model="sliceCoords.t" label="t" v-bind="ranges.t" />
    </div>
  </div>
</template>

<style scoped>
.viewer {
  margin: 32px 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
}

.viewer-canvas {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 2;
  background: #000;
}

.viewer-canvas canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.viewer-error {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
  padding: 16px;
  text-align: center;
  color: var(--vp-c-text-2);
}

.viewer-controls {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 14px;
  background: var(--vp-c-bg-soft);
  font-size: 13px;
  line-height: 1.4;
}
</style>
