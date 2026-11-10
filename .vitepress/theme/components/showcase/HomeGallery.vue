<script setup lang="ts">
import ShowcaseGallery from "./ShowcaseGallery.vue";
</script>

<template>
  <section class="home-gallery">
    <div class="container">
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
</style>
