<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type {
  SliceOrientation,
  SourceDimension,
  SourceDimensionMap,
} from "idetik";
import RangeSlider from "../../RangeSlider.vue";
import clock from "../../icons/clock.svg?raw";
import play from "../../icons/play.svg?raw";
import pause from "../../icons/pause.svg?raw";

type Axis = "x" | "y" | "z" | "t";
type Mode = SliceOrientation | "T";

type Variant = "orientation" | "time" | "playback" | "z";

const MODE_AXIS: Record<Mode, Axis> = {
  XY: "z",
  XZ: "y",
  YZ: "x",
  T: "t",
};

const props = withDefaults(
  defineProps<{
    dims: SourceDimensionMap;
    sliceCoords: Partial<Record<Axis, number>>;
    variant?: Variant;
  }>(),
  { variant: "orientation" }
);

const mode = defineModel<Mode>("mode", { default: "XY" });

const PLANES: SliceOrientation[] = ["XY", "XZ", "YZ"];

const hasTime = computed(() => (props.dims.t?.lods[0].size ?? 1) > 1);

const axis = computed<Axis>(() => {
  switch (props.variant) {
    case "orientation":
      return MODE_AXIS[mode.value];
    case "z":
      return "z";
    default:
      return "t";
  }
});

const FRAME_MS = 100;
const playing = ref(props.variant === "playback");
let timer: ReturnType<typeof setInterval> | undefined;

watch(
  playing,
  (on) => {
    clearInterval(timer);
    if (on) timer = setInterval(advance, FRAME_MS);
  },
  { immediate: true }
);

onBeforeUnmount(() => clearInterval(timer));

function advance() {
  const { min, max, step } = rangeOf(props.dims.t!);
  const t = props.sliceCoords.t! + step;
  props.sliceCoords.t = t > max ? min : t;
}

function rangeOf(dim: SourceDimension) {
  const { translation, size, scale } = dim.lods[0];
  return {
    min: translation,
    max: translation + (size - 1) * scale,
    step: scale,
  };
}
</script>

<template>
  <div v-if="dims[axis]" class="viewer-controls">
    <div class="slider">
      <RangeSlider
        v-model="sliceCoords[axis]!"
        :label="axis"
        :unit="axis === 't' ? undefined : 'µm'"
        v-bind="rangeOf(dims[axis]!)"
      />
    </div>
    <div v-if="variant === 'playback'" class="modes">
      <button
        type="button"
        :aria-label="playing ? 'Pause' : 'Play'"
        :title="playing ? 'Pause' : 'Play'"
        @click="playing = !playing"
      >
        <span
          class="icon"
          aria-hidden="true"
          v-html="playing ? pause : play"
        ></span>
      </button>
    </div>
    <div v-else-if="variant !== 'z'" class="toggles">
      <div v-if="variant === 'orientation'" class="modes">
        <button
          v-for="m in PLANES"
          :key="m"
          type="button"
          :class="{ active: m === mode }"
          :aria-pressed="m === mode"
          @click="mode = m"
        >
          {{ m }}
        </button>
      </div>
      <div v-if="hasTime" class="modes">
        <button
          type="button"
          :class="{ active: axis === 't' }"
          :aria-pressed="axis === 't'"
          aria-label="Time"
          title="Time"
          @click="mode = 'T'"
        >
          <span class="icon" aria-hidden="true" v-html="clock"></span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.viewer-controls {
  display: flex;
  align-items: center;
  gap: 14px;
}

.slider {
  flex: 1;
  min-width: 0;
}

.toggles {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
}

.modes {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--panel-border);
  border-radius: 6px;
}

.modes button {
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--panel-text-2);
  transition:
    color 0.2s,
    background-color 0.2s;
}

.modes button:hover {
  color: var(--panel-text-1);
}

.icon {
  display: inline-flex;
  width: 14px;
  height: 14px;
  vertical-align: middle;
}

.icon :deep(svg) {
  width: 100%;
  height: 100%;
}

.modes button.active {
  color: var(--panel-text-1);
  background-color: rgb(var(--brand-rgb) / 0.3);
}
</style>
