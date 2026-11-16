<script setup lang="ts">
import ExamplesGallery from "./ExamplesGallery.vue";
</script>

<template>
  <section class="home-gallery">
    <div class="container">
      <div class="intro">
        <h2 class="heading">Examples</h2>
        <p class="description">
          Live viewers built with Idetik on public
          <span class="nowrap">OME-Zarr</span> datasets. Tap to explore in your
          browser and view the source code.
        </p>
      </div>
      <ExamplesGallery />
    </div>
  </section>
</template>

<style scoped>
.home-gallery {
  margin-top: var(--home-section-gap);
  padding: 59px 24px 0;
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

.intro {
  margin-bottom: 32px;
}

.heading {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.15;
  color: var(--vp-c-text-1);
}

.description {
  margin: 24px 0 0;
  max-width: 480px;
  font-size: 16px;
  line-height: 1.65;
  color: var(--vp-c-text-2);
}

.nowrap {
  white-space: nowrap;
}

@media (min-width: 640px) {
  .intro {
    display: none;
  }
}
</style>
