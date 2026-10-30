<script setup lang="ts">
import { ref } from "vue";
import claude from "../icons/claude.svg?raw";
import openai from "../icons/openai.svg?raw";
import cursor from "../icons/cursor.svg?raw";
import copyIcon from "../icons/copy.svg?raw";
import checkIcon from "../icons/check.svg?raw";

const DOCS_URL = "https://biohub.github.io/idetik/";
const IMAGE_PLACEHOLDER = "{PLACE YOUR IMAGE URL HERE}";

const AGENTS = [
  { name: "Claude Code", icon: claude },
  { name: "Codex", icon: openai },
  { name: "Cursor", icon: cursor },
];

const PARAGRAPHS = [
  "# Set up my first Idetik viewer",
  `Create a Vite + TypeScript project with idetik, using ${DOCS_URL} as your reference.`,
  `Build a full-window 2D viewer with pan/zoom and a z slider for this OME-Zarr image:\n${IMAGE_PLACEHOLDER}`,
  "Start the dev server and confirm the image renders.",
];

const PROMPT = PARAGRAPHS.join("\n\n");

const HIGHLIGHTS: Record<string, string> = {
  "# ": "muted",
  idetik: "accent",
  [DOCS_URL]: "link",
  [IMAGE_PLACEHOLDER]: "link",
};

const TOKENS = new RegExp(
  `(${Object.keys(HIGHLIGHTS)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})`
);

const segments = PARAGRAPHS.map((paragraph) =>
  paragraph
    .split(TOKENS)
    .filter(Boolean)
    .map((text) => ({ text, kind: HIGHLIGHTS[text] }))
);

const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

async function copy() {
  await navigator.clipboard.writeText(PROMPT);
  copied.value = true;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <section class="agent-prompt">
    <div class="container">
      <div class="intro">
        <h2 class="title">Get started with your favorite coding agent</h2>
        <ul class="agents">
          <li v-for="agent in AGENTS" :key="agent.name" class="agent">
            <span
              class="agent-icon"
              aria-hidden="true"
              v-html="agent.icon"
            ></span>
            {{ agent.name }}
          </li>
        </ul>
        <p class="description">
          Paste this prompt into any agent and add your image URL. It scaffolds
          a project, installs Idetik, and renders your first OME-Zarr image in a
          single viewport.
        </p>
      </div>
      <div class="card">
        <button
          type="button"
          class="copy"
          :aria-label="copied ? 'Copied' : 'Copy prompt'"
          :title="copied ? 'Copied' : 'Copy prompt'"
          @click="copy"
        >
          <span
            class="copy-icon"
            aria-hidden="true"
            v-html="copied ? checkIcon : copyIcon"
          ></span>
        </button>
        <div class="prompt">
          <p v-for="(paragraph, i) in segments" :key="i">
            <span
              v-for="(segment, j) in paragraph"
              :key="j"
              :class="segment.kind"
              v-text="segment.text"
            />
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.agent-prompt {
  position: relative;
  isolation: isolate;
  margin-top: var(--home-section-gap);
  padding: 64px 24px;
  border-top: 1px solid var(--vp-c-gutter);
}

.agent-prompt::before,
.agent-prompt::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
}

.agent-prompt::before {
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

:global(.dark) .agent-prompt::before {
  background:
    radial-gradient(
      40% 60% at 75% 50%,
      rgb(var(--brand-rgb) / 0.24),
      transparent 72%
    ),
    radial-gradient(
      50% 90% at 8% 0%,
      rgb(var(--brand-rgb) / 0.2),
      transparent 70%
    );
}

.agent-prompt::after {
  opacity: 0.08;
  background-image: var(--noise);
}

@media (min-width: 640px) {
  .agent-prompt {
    padding: 64px 48px;
  }
}

@media (min-width: 960px) {
  .agent-prompt {
    padding: 64px;
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

.agents {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 28px;
  margin: 24px 0 0;
  padding: 0;
  list-style: none;
}

.agent {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  color: var(--vp-c-text-2);
}

.agent-icon {
  display: inline-flex;
  width: 18px;
  height: 18px;
}

.agent-icon :deep(svg),
.copy-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

.description {
  margin: 24px 0 0;
  max-width: 480px;
  font-size: 18px;
  line-height: 1.65;
  color: var(--vp-c-text-2);
}

.card {
  position: relative;
  isolation: isolate;
  min-width: 0;
  padding: 32px;
  border: 1px solid var(--panel-border);
  border-radius: 12px;
  background: rgb(var(--panel-bg-rgb) / 0.55);
  overflow: hidden;
}

.card::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  opacity: 0.06;
  background-image: var(--noise);
  pointer-events: none;
}

.copy {
  position: absolute;
  top: 16px;
  right: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  color: var(--panel-text-2);
  transition:
    color 0.2s,
    background-color 0.2s;
}

.copy:hover {
  color: var(--panel-text-1);
  background-color: var(--panel-hover);
}

.copy-icon {
  display: inline-flex;
  width: 16px;
  height: 16px;
}

.prompt {
  padding-right: 40px;
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  line-height: 1.85;
  color: var(--panel-text-1);
}

.prompt p {
  margin: 0;
  white-space: pre-wrap;
}

.prompt p + p {
  margin-top: 1.85em;
}

.muted {
  color: var(--panel-text-3);
}

.accent {
  color: var(--panel-accent);
}

.link {
  color: #e9cf8f;
  word-break: break-all;
}
</style>
