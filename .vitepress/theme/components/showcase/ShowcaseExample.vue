<script setup lang="ts">
import { computed } from "vue";
import { useData, withBase } from "vitepress";

// docs/showcase/[id].md embeds the built examples/<id>/ app; params come from
// .vitepress/showcase.js.
const { params } = useData();
const src = computed(() => withBase(`/examples/${params.value.id}/index.html`));
const source = computed(
  () =>
    `https://github.com/chanzuckerberg/idetik/tree/main/examples/${params.value.id}`
);
</script>

<template>
  <div class="vp-raw showcase-example">
    <div class="header">
      <div>
        <h1>{{ params.title }}</h1>
        <p class="desc">{{ params.description }}</p>
      </div>
      <div class="actions">
        <a :href="src" target="_blank" rel="noopener">Open full screen ↗</a>
        <a :href="source" target="_blank" rel="noopener">Source on GitHub ↗</a>
      </div>
    </div>
    <iframe :src="src" :title="params.title" allow="fullscreen" />
    <p class="data">Data: {{ params.data }}</p>
  </div>
</template>

<style scoped>
.header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin: 0 0 20px;
}

h1 {
  font-size: 32px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.02em;
}

.desc {
  margin-top: 8px;
  color: var(--vp-c-text-2);
}

.actions {
  display: flex;
  gap: 8px;
}

.actions a {
  padding: 6px 14px;
  border: 1px solid var(--vp-button-alt-border);
  border-radius: var(--radius-pill);
  font-size: 13px;
  color: var(--vp-c-text-1);
  text-decoration: none;
  transition: border-color 0.25s;
}

.actions a:hover {
  border-color: var(--vp-button-alt-hover-border);
}

iframe {
  display: block;
  width: 100%;
  height: 640px;
  border: 1px solid var(--vp-c-gutter);
  border-radius: 12px;
  background-color: #000;
}

.data {
  margin: 10px 0 32px;
  font-size: 13px;
  color: var(--vp-c-text-2);
}
</style>
