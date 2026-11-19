<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useData } from "vitepress";
import vertexSource from "./hero_glow_vert.glsl";
import fragmentSource from "./hero_glow_frag.glsl";

const { isDark } = useData();
const canvas = ref<HTMLCanvasElement>();
const ready = ref(false);

let cleanup = () => {};

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn(gl.getShaderInfoLog(shader));
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext) {
  const program = gl.createProgram()!;
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(
    program,
    compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  );
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

function start(el: HTMLCanvasElement) {
  const gl = el.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: "low-power",
    failIfMajorPerformanceCaveat: true,
  });

  const program = gl && createProgram(gl);
  if (!gl || !program) return () => {};
  gl.useProgram(program);

  const uniforms = {
    resolution: gl.getUniformLocation(program, "u_res"),
    time: gl.getUniformLocation(program, "u_time"),
    mouse: gl.getUniformLocation(program, "u_mouse"),
    hover: gl.getUniformLocation(program, "u_hover"),
  };

  const animated = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pointer = { x: 0, y: 0, active: false };
  const mouse = { x: 0, y: 0, hover: 0 };

  let time = 0;
  let previous = 0;
  let frame = 0;

  const draw = () => {
    gl.uniform1f(uniforms.time, time);
    gl.uniform2f(uniforms.mouse, mouse.x, mouse.y);
    gl.uniform1f(uniforms.hover, mouse.hover);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const resize = () => {
    el.width = el.clientWidth;
    el.height = el.clientHeight;
    gl.viewport(0, 0, el.width, el.height);
    gl.uniform2f(uniforms.resolution, el.width, el.height);
    draw();
  };

  const followPointer = (seconds: number) => {
    const box = el.getBoundingClientRect();
    const x = (pointer.x - box.left - box.width / 2) / box.height;
    const y = (box.top + box.height / 2 - pointer.y) / box.height;
    const over =
      pointer.active &&
      pointer.x >= box.left &&
      pointer.x <= box.right &&
      pointer.y >= box.top &&
      pointer.y <= box.bottom;
    const ease = 1 - Math.exp(-5 * seconds);
    mouse.x += (x - mouse.x) * ease;
    mouse.y += (y - mouse.y) * ease;
    mouse.hover += ((over ? 1 : 0) - mouse.hover) * ease;
  };

  const render = (now: number) => {
    followPointer((now - previous) / 1000);
    previous = now;
    time = now / 1000;
    draw();
    frame = requestAnimationFrame(render);
  };

  const resizer = new ResizeObserver(resize);
  const visibility = new IntersectionObserver(([entry]) => {
    cancelAnimationFrame(frame);
    if (animated && entry.isIntersecting) {
      frame = requestAnimationFrame(render);
    }
  });
  const listeners = new AbortController();
  const { signal } = listeners;

  const stop = () => {
    ready.value = false;
    cancelAnimationFrame(frame);
    resizer.disconnect();
    visibility.disconnect();
    listeners.abort();
  };

  addEventListener(
    "pointermove",
    (event) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = event.pointerType !== "touch";
    },
    { signal, passive: true }
  );
  document.documentElement.addEventListener(
    "pointerleave",
    () => {
      pointer.active = false;
    },
    { signal }
  );
  el.addEventListener("webglcontextlost", stop, { signal });

  resize();
  resizer.observe(el);
  visibility.observe(el);
  ready.value = true;

  return () => {
    stop();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
}

onMounted(() => {
  if (isDark.value) cleanup = start(canvas.value!);
});

onBeforeUnmount(() => cleanup());
</script>

<template>
  <div class="hero-glow" aria-hidden="true">
    <canvas ref="canvas" :class="{ ready }" />
  </div>
</template>

<style scoped>
.hero-glow {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 920px;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(410px 310px at 90% 44%, rgb(110 79 249 / 9%), transparent),
    radial-gradient(280px 220px at 70% 18%, rgb(217 70 239 / 5%), transparent),
    radial-gradient(380px 300px at 12% 58%, rgb(34 211 238 / 7%), transparent),
    radial-gradient(260px 200px at 30% 8%, rgb(110 79 249 / 5%), transparent);
  -webkit-mask-image: linear-gradient(to bottom, #000 70%, transparent);
  mask-image: linear-gradient(to bottom, #000 70%, transparent);
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
  opacity: 0;
  transition: opacity 0.9s ease;
}

canvas.ready {
  opacity: 1;
}
</style>
