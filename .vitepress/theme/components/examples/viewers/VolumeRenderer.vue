<script setup lang="ts">
import { shallowReactive, shallowRef } from "vue";
import type { SourceDimension, SourceDimensionMap } from "@idetik/core";
import SliceControls from "../SliceControls.vue";
import { useIdetikViewer } from "../useIdetikViewer";

const dims = shallowRef<SourceDimensionMap | null>(null);
const sliceCoords = shallowReactive({ t: 400 });

function extentOf(dim: SourceDimension): number {
  const { size, scale } = dim.lods[0];
  return size * scale;
}

function centerOf(dim: SourceDimension): number {
  const { translation } = dim.lods[0];
  return translation + extentOf(dim) / 2;
}

const canvas = useIdetikViewer(
  async (
    {
      Idetik,
      OmeZarrImageSource,
      OrbitControls,
      PerspectiveCamera,
      Color,
      VolumeLayer,
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
    const { x, y } = dims.value;
    const z = dims.value.z!;

    const camera = new PerspectiveCamera();
    const radius = 0.7 * Math.hypot(extentOf(x), extentOf(y), extentOf(z));

    const layer = new VolumeLayer({
      source,
      sliceCoords,
      policy: createExplorationPolicy({ lod: { min: 2, max: 2 } }),
      channelProps: [{ color: Color.WHITE, contrastLimits: [0, 60] }],
    });

    layer.opacityMultiplier = 0.015;
    layer.relativeStepSize = 0.3;

    return new Idetik({
      canvas: target,
      viewports: [
        new Viewport({
          domElement: target,
          camera,
          cameraControls: new OrbitControls(camera, {
            radius,
            target: [centerOf(x), centerOf(y), centerOf(z)],
            scrollZoom: "modifier",
            dampingFactor: 0.25,
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
      :dims="dims"
      :slice-coords="sliceCoords"
      variant="time"
    />
  </div>
</template>
