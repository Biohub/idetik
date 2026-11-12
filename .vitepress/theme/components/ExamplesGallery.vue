<script setup lang="ts">
import { withBase } from "vitepress";
import { examples } from "../../../examples/examples.ts";
</script>

<template>
  <div class="vp-raw examples-gallery">
    <div class="grid">
      <a
        v-for="item in examples"
        :key="item.id"
        :href="withBase(`/examples/${item.id}.html`)"
        class="card"
      >
        <img
          :src="withBase(`/examples/live/${item.id}/thumbnail.jpg`)"
          alt=""
          loading="lazy"
        />
        <div class="body">
          <div class="title">{{ item.title }}</div>
          <div class="desc">{{ item.data }}</div>
          <div v-if="item.tags.length" class="tags">
            <span v-for="tag in item.tags" :key="tag" class="tag">{{
              tag
            }}</span>
          </div>
        </div>
      </a>
    </div>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 24px;
}

.card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--vp-c-gutter);
  border-radius: 12px;
  color: var(--vp-c-text-1);
  text-decoration: none;
  transition: border-color 0.25s;
}

.dark .card {
  border-color: #27272b;
}

.card:hover {
  border-color: var(--vp-c-border);
}

.card img {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  background-color: #000;
}

.body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px 16px;
  background: rgb(0 0 0 / 0.025);
}

.dark .body {
  background: #1c1c20;
}

.title {
  font-size: 15px;
  font-weight: 600;
}

.desc {
  font-size: 13px;
  line-height: 1.5;
  color: var(--vp-c-text-2);
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}

.tag {
  padding: 0 10px;
  border-radius: var(--radius-pill);
  background: rgb(0 0 0 / 0.06);
  font-size: 12px;
  font-weight: 500;
  line-height: 22px;
  color: var(--vp-c-text-2);
}

.dark .tag {
  background: #3e3e41;
  color: rgb(235 235 245 / 0.62);
}
</style>
