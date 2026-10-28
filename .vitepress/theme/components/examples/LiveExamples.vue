<script setup lang="ts">
import { ref, type Component } from "vue";
import { withBase } from "vitepress";
import ExampleNavigator from "./ExampleNavigator.vue";
import VolumeRenderer from "./viewers/VolumeRenderer.vue";
import MultiscaleImage from "./viewers/MultiscaleImage.vue";
import MultipleViewports from "./viewers/MultipleViewports.vue";
import TemporalPlayback from "./viewers/TemporalPlayback.vue";
import SegmentationLabels from "./viewers/SegmentationLabels.vue";
import { examples } from "./examples";

const viewers: Record<string, Component> = {
  "volume-rendering": VolumeRenderer,
  "multiscale-image": MultiscaleImage,
  "multiple-viewports": MultipleViewports,
  "temporal-playback": TemporalPlayback,
  "segmentation-labels": SegmentationLabels,
};

const selected = ref(examples[0].id);

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent);
const scrollHint = ref(false);
let scrollHintTimer: ReturnType<typeof setTimeout> | undefined;

function onWheel(e: WheelEvent) {
  if (!(e.target instanceof Element) || !e.target.closest("canvas, .viewport"))
    return;
  clearTimeout(scrollHintTimer);
  scrollHint.value = !(e.ctrlKey || e.metaKey);
  if (scrollHint.value) {
    scrollHintTimer = setTimeout(() => (scrollHint.value = false), 800);
  }
}
</script>

<template>
  <section class="live-examples">
    <div class="container">
      <div class="showcase">
        <div class="stage" @wheel.passive="onWheel">
          <component :is="viewers[selected]" class="viewer" />
          <ExampleNavigator v-model="selected" class="navigator" />
          <Transition name="fade">
            <div v-if="scrollHint" class="scroll-hint" aria-hidden="true">
              Use {{ isMac ? "⌘" : "Ctrl" }} + scroll to zoom
            </div>
          </Transition>
        </div>
      </div>
      <a class="see-all" :href="withBase('/showcase/')">See all examples →</a>
    </div>
  </section>
</template>

<style scoped>
.live-examples {
  margin-top: var(--home-section-gap);
  padding: 64px 24px 0;
  border-top: 1px solid var(--vp-c-gutter);
  background-color: var(--vp-c-bg);
}

@media (min-width: 640px) {
  .live-examples {
    padding: 64px 48px 0;
  }
}

@media (min-width: 960px) {
  .live-examples {
    padding: 64px 64px 0;
  }
}

.container {
  margin: 0 auto;
  max-width: var(--home-max-width);
}

.see-all {
  display: block;
  margin-top: 16px;
  text-align: right;
  font-size: 14px;
  color: var(--vp-c-brand-1);
}

.showcase {
  display: flex;
  flex-direction: column;
  height: 680px;
  border: 1px solid var(--vp-c-gutter);
  border-radius: 12px;
  box-shadow:
    0 1px 2px rgb(17 17 20 / 0.04),
    0 12px 32px rgb(17 17 20 / 0.08);
  overflow: hidden;
}

:global(.dark) .showcase {
  border-color: var(--panel-border);
}

@media (min-width: 960px) {
  .showcase {
    height: 860px;
  }
}

.stage {
  --controls-height: 52px;

  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  background-color: #000;
}

.viewer {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
}

.stage :deep(canvas) {
  display: block;
  flex: 1;
  width: 100%;
  min-height: 0;
}

.navigator {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 2;
}

.stage :deep(.viewer-controls) {
  --vp-c-text-2: var(--panel-text-2);
  --vp-c-divider: var(--panel-border);
  --vp-c-brand-1: var(--panel-accent);

  flex-shrink: 0;
  box-sizing: border-box;
  height: var(--controls-height);
  padding: 0 20px;
  border-top: 1px solid var(--panel-border);
  background: var(--panel-bg);
  font-size: 13px;
  line-height: 1.4;
}

.scroll-hint {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 0.45);
  color: #fff;
  font-size: 20px;
  font-weight: 600;
  pointer-events: none;
}

.stage:has(.viewer-controls) .scroll-hint {
  bottom: var(--controls-height);
}

.fade-enter-active {
  transition: opacity 0.15s ease;
}

.fade-leave-active {
  transition: opacity 0.4s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
