<script setup lang="ts">
import { shallowReactive, shallowRef } from "vue";
import type { SourceDimension, SourceDimensionMap } from "@idetik/core";
import SliceControls from "../SliceControls.vue";
import { useIdetikViewer } from "../useIdetikViewer";

const dims = shallowRef<SourceDimensionMap | null>(null);
const sliceCoords = shallowReactive({ t: 0, z: 0 });

const FRAME_PADDING = 0.1;

function paddedExtentOf(dim: SourceDimension): [number, number] {
  const { translation, size, scale } = dim.lods[0];
  const pad = FRAME_PADDING * size * scale;
  return [translation - pad, translation + size * scale + pad];
}

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
      createPlaybackPolicy,
    },
    target
  ) => {
    const baseUrl = "https://public.czbiohub.org/organelle_box/datasets/A549";
    const source = await OmeZarrImageSource.fromHttp({
      url: `${baseUrl}/2024_11_07_A549_SEC61_DENV_cropped.zarr/B/3/000000/`,
    });

    dims.value = source.getDimensions();
    const { translation, size, scale } = dims.value.z!.lods[0];
    sliceCoords.z = translation + Math.floor((size - 1) / 2) * scale;

    const [left, right] = paddedExtentOf(dims.value.x);
    const [top, bottom] = paddedExtentOf(dims.value.y);
    const camera = new OrthographicCamera({ left, right, top, bottom });

    const layer = new ImageLayer({
      source,
      sliceCoords,
      policy: createPlaybackPolicy(),
      channelProps: [
        { visible: false },
        { color: Color.WHITE, contrastLimits: [5, 154] },
        { visible: false },
      ],
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
      :dims="dims"
      :slice-coords="sliceCoords"
      variant="playback"
    />
  </div>
</template>
