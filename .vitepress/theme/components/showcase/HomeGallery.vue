<script setup lang="ts">
import { withBase } from "vitepress";
import ShowcaseGallery from "./ShowcaseGallery.vue";
</script>

<template>
  <section class="home-gallery">
    <div class="container">
      <h2 class="title">
        <a :href="withBase('/showcase/')">Examples</a>
      </h2>
      <ShowcaseGallery />
    </div>
  </section>
</template>

<style scoped>
.home-gallery {
  margin-top: var(--home-section-gap);
  padding: 64px 24px 0;
  border-top: 1px solid var(--vp-c-gutter);
}

@media (min-width: 640px) {
  .home-gallery {
    padding: 64px 48px 0;
  }
}

@media (min-width: 960px) {
  .home-gallery {
    padding: 64px 64px 0;
  }
}

.container {
  margin: 0 auto;
  max-width: var(--home-max-width);
}

/* Same scale as the agent prompt's heading below. */
.title {
  margin: 0;
  font-size: 36px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.15;
}

@media (min-width: 640px) {
  .title {
    font-size: 44px;
  }
}

.title a {
  color: var(--vp-c-text-1);
  text-decoration: none;
}

.title a:hover {
  color: var(--vp-c-brand-1);
}
</style>
