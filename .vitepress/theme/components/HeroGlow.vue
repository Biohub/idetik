<script setup lang="ts">
const BLOBS = [
  {
    x: "90%",
    y: "44%",
    w: 820,
    h: 620,
    rgb: "110 79 249",
    a: 0.22,
    dx: "-155px",
    dy: "90px",
    drift: 25,
    pulse: 16,
  },
  {
    x: "70%",
    y: "18%",
    w: 560,
    h: 440,
    rgb: "217 70 239",
    a: 0.12,
    dx: "135px",
    dy: "110px",
    drift: 29,
    pulse: 19,
  },
  {
    x: "12%",
    y: "58%",
    w: 760,
    h: 600,
    rgb: "34 211 238",
    a: 0.17,
    dx: "180px",
    dy: "-95px",
    drift: 21,
    pulse: 14,
  },
  {
    x: "30%",
    y: "8%",
    w: 520,
    h: 400,
    rgb: "110 79 249",
    a: 0.12,
    dx: "-115px",
    dy: "75px",
    drift: 33,
    pulse: 22,
  },
];

const style = (b: (typeof BLOBS)[number], i: number) => ({
  left: `calc(${b.x} - ${b.w / 2}px)`,
  top: `calc(${b.y} - ${b.h / 2}px)`,
  width: `${b.w}px`,
  height: `${b.h}px`,
  "--rgb": b.rgb,
  "--a": b.a,
  "--dx": b.dx,
  "--dy": b.dy,
  "--drift": `${b.drift}s`,
  "--pulse": `${b.pulse}s`,
  "--delay": `${-(i + 1) * 7}s`,
});
</script>

<template>
  <div class="hero-glow" aria-hidden="true">
    <div v-for="(b, i) in BLOBS" :key="i" class="blob" :style="style(b, i)">
      <div class="core" />
    </div>
  </div>
</template>

<style scoped>
.hero-glow {
  --k: 0.45;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 920px;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
  -webkit-mask-image: linear-gradient(to bottom, #000 70%, transparent);
  mask-image: linear-gradient(to bottom, #000 70%, transparent);
}

.dark .hero-glow {
  --k: 1;
}

.blob {
  position: absolute;
  animation: drift var(--drift) ease-in-out var(--delay) infinite;
  will-change: transform;
}

.core {
  width: 100%;
  height: 100%;
  background: radial-gradient(
    closest-side,
    rgb(var(--rgb) / calc(var(--a) * var(--k))),
    transparent
  );
  animation: pulse var(--pulse) ease-in-out var(--delay) infinite alternate;
  will-change: transform, opacity;
}

@keyframes drift {
  0%,
  100% {
    transform: translate(0, 0);
  }
  33% {
    transform: translate(var(--dx), calc(var(--dy) * 0.4));
  }
  66% {
    transform: translate(calc(var(--dx) * 0.35), var(--dy));
  }
}

@keyframes pulse {
  from {
    transform: scale(0.84);
    opacity: 0.55;
  }
  to {
    transform: scale(1.16);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .blob,
  .core {
    animation: none;
  }
}
</style>
