<script setup lang="ts">
import { withBase } from "vitepress";
import { data as examples } from "./examples.data.js";
import builtWith from "./built-with.json";
</script>

<template>
  <div class="vp-raw showcase-gallery">
    <div class="grid">
      <a
        v-for="item in examples"
        :key="item.id"
        :href="withBase(`/showcase/${item.id}.html`)"
        class="card"
      >
        <img
          :src="withBase(`/examples/${item.id}/thumbnail.jpg`)"
          alt=""
          loading="lazy"
        />
        <div class="body">
          <div class="title">{{ item.title }}</div>
          <div class="desc">{{ item.description }}</div>
          <span class="tag">{{ item.data }}</span>
        </div>
      </a>
    </div>

    <h2>Built with Idetik</h2>
    <div class="grid">
      <a
        v-for="item in builtWith"
        :key="item.url"
        :href="item.url"
        target="_blank"
        rel="noopener"
        class="card"
      >
        <img :src="withBase(item.image)" alt="" loading="lazy" />
        <div class="body">
          <div class="title">{{ item.title }} ↗</div>
          <div class="desc">{{ item.description }}</div>
          <span class="link">{{ item.url.replace(/^https?:\/\//, "") }}</span>
        </div>
      </a>
    </div>
  </div>
</template>

<style scoped>
.showcase-gallery {
  margin-top: 32px;
}

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

.card:hover {
  border-color: var(--vp-c-brand-1);
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
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px 16px;
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

.tag {
  align-self: flex-start;
  margin-top: 4px;
  padding: 2px 10px;
  border: 1px solid var(--vp-c-gutter);
  border-radius: var(--radius-pill);
  font-size: 11px;
  color: var(--vp-c-text-2);
}

.link {
  margin-top: 4px;
  font-size: 12px;
  color: var(--vp-c-brand-1);
}

h2 {
  margin: 56px 0 20px;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
</style>
