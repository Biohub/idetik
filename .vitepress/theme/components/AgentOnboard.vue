<script setup lang="ts">
import { computed, ref } from "vue";
import claude from "../icons/claude.svg?raw";
import openai from "../icons/openai.svg?raw";
import cursor from "../icons/cursor.svg?raw";
import copyIcon from "../icons/copy.svg?raw";
import checkIcon from "../icons/check.svg?raw";

const DOCS_URL = "https://biohub.github.io/idetik/";

const AGENTS = [
  { name: "Claude Code", icon: claude },
  { name: "Codex", icon: openai },
  { name: "Cursor", icon: cursor },
];

const url = ref("");

const prompt = computed(() => {
  const imageUrl = url.value.trim();
  return [
    "# Set up my first Idetik viewer",
    `Create a Vite + TypeScript project with idetik, using ${DOCS_URL} as your reference.`,
    imageUrl
      ? `Build a full-window 2D viewer with pan/zoom and a z slider for this OME-Zarr image:\n${imageUrl}`
      : "Build a full-window 2D viewer with pan/zoom and a z slider for an OME-Zarr image. Ask me for the image URL before you start.",
    "Start the dev server and confirm the image renders.",
  ].join("\n\n");
});

const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

async function copy() {
  await navigator.clipboard.writeText(prompt.value);
  copied.value = true;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <section class="agent-onboard">
    <div class="container">
      <div class="intro">
        <h2 class="title">Get started with your favorite coding agent</h2>
        <p class="description">
          Paste the URL of your <span class="nowrap">OME-Zarr</span> image and
          copy a ready-made prompt for Claude Code, Codex, or Cursor. Your
          agent scaffolds a Vite project, installs Idetik, and renders the
          image in a single viewport.
        </p>
      </div>
      <form class="form" @submit.prevent="copy">
        <input
          id="agent-image-url"
          v-model="url"
          class="input"
          type="text"
          aria-label="Image URL"
          inputmode="url"
          autocomplete="off"
          spellcheck="false"
          placeholder="Paste an OME-Zarr URL (optional)"
        />
        <button type="submit" class="onboard">
            <span class="logos" aria-hidden="true">
              <span
                v-for="agent in AGENTS"
                :key="agent.name"
                class="logo"
                :title="agent.name"
                v-html="agent.icon"
              ></span>
            </span>
            <span aria-live="polite">{{
              copied ? "Paste into your agent" : "Onboard your agent"
            }}</span>
            <span
              class="copy-icon"
              aria-hidden="true"
              v-html="copied ? checkIcon : copyIcon"
            ></span>
          </button>
      </form>
    </div>
  </section>
</template>

<style scoped>
.agent-onboard {
  position: relative;
  isolation: isolate;
  margin-top: var(--home-section-gap);
  padding: 77px 24px;
  border-top: 1px solid var(--vp-c-gutter);
}

.agent-onboard::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(
      40% 60% at 75% 50%,
      rgb(var(--brand-rgb) / 0.1),
      transparent 72%
    ),
    radial-gradient(
      50% 90% at 8% 0%,
      rgb(var(--brand-rgb) / 0.08),
      transparent 70%
    );
}

@media (min-width: 640px) {
  .agent-onboard {
    padding: 77px 48px;
  }
}

@media (min-width: 960px) {
  .agent-onboard {
    padding: 77px 64px;
  }
}

.container {
  display: grid;
  gap: 48px;
  align-items: center;
  margin: 0 auto;
  max-width: var(--home-max-width);
}

@media (min-width: 960px) {
  .container {
    grid-template-columns: 5fr 6fr;
    gap: 64px;
  }
}

.title {
  margin: 0;
  font-size: 36px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.15;
  color: var(--vp-c-text-1);
}

@media (min-width: 640px) {
  .title {
    font-size: 44px;
  }
}

.description {
  margin: 24px 0 0;
  max-width: 480px;
  font-size: 18px;
  line-height: 1.65;
  color: var(--vp-c-text-2);
}

.nowrap {
  white-space: nowrap;
}

.form {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
  min-width: 0;
}


.input {
  width: 100%;
  height: 44px;
  padding: 0 14px;
  border: 1px solid var(--panel-border);
  border-radius: 10px;
  background: rgb(255 255 255 / 0.04);
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  color: var(--panel-text-1);
  transition: border-color 0.2s;
}

.input::placeholder {
  color: var(--panel-text-3);
}

.input:focus {
  outline: none;
  border-color: var(--vp-c-brand-1);
}

.onboard {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  height: 40px;
  padding: 0 14px 0 6px;
  border-radius: var(--radius-pill);
  background: rgb(255 255 245 / 0.92);
  font-size: 14px;
  font-weight: 500;
  color: #111114;
  transition: background-color 0.2s;
}

.onboard:hover {
  background: #fff;
}

.logos {
  display: inline-flex;
}

.logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #111114;
  color: #fff;
  box-shadow: 0 0 0 2px rgb(255 255 245 / 0.92);
}

.logo + .logo {
  margin-left: -8px;
}

.logo :deep(svg) {
  width: 15px;
  height: 15px;
}

.copy-icon {
  display: inline-flex;
  width: 16px;
  height: 16px;
  color: rgb(17 17 20 / 0.55);
}

.copy-icon :deep(svg) {
  width: 100%;
  height: 100%;
}
</style>
