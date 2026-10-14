<script setup lang="ts">
import { shallowReactive, shallowRef } from "vue";
import type { SourceDimension, SourceDimensionMap } from "@idetik/core";
import SliceControls from "../SliceControls.vue";
import { useIdetikViewer } from "../useIdetikViewer";

const dims = shallowRef<SourceDimensionMap | null>(null);
const sliceCoords = shallowReactive({ z: 0, c: [0, 1] });

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
      LabelLayer,
      OmeZarrImageSource,
      OrthographicCamera,
      PanZoomControls,
      Viewport,
    },
    target
  ) => {
    const imageUrl =
      "https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.4/idr0062A/6001240.zarr";
    const [imageSource, labelsSource] = await Promise.all([
      OmeZarrImageSource.fromHttp({ url: imageUrl }),
      OmeZarrImageSource.fromHttp({ url: `${imageUrl}/labels/0` }),
    ]);

    dims.value = imageSource.getDimensions();
    const { translation, size, scale } = dims.value.z!.lods[0];
    sliceCoords.z = translation + Math.floor((size - 1) / 2) * scale;

    const [left, right] = paddedExtentOf(dims.value.x);
    const [top, bottom] = paddedExtentOf(dims.value.y);
    const camera = new OrthographicCamera({ left, right, top, bottom });

    const imageLayer = new ImageLayer({
      source: imageSource,
      sliceCoords,
      channelProps: [
        { color: Color.GREEN, contrastLimits: [0, 1024] },
        { color: Color.MAGENTA, contrastLimits: [0, 1024] },
      ],
    });

    const labelsLayer = new LabelLayer({
      source: labelsSource,
      sliceCoords: {
        get z() {
          return sliceCoords.z;
        },
        c: [0],
      },
      opacity: 0.55,
      blendMode: "normal",
      onPickValue: ({ value }) => {
        labelsLayer.setColorMap({
          cycle: Array.from(labelsLayer.colorMap.cycle),
          lookupTable: value ? new Map([[value, Color.WHITE]]) : undefined,
        });
      },
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
          layers: [imageLayer, labelsLayer],
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
      variant="z"
      :dims="dims"
      :slice-coords="sliceCoords"
    />
  </div>
</template>
