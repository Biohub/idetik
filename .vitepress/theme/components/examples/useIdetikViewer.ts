import { onBeforeUnmount, onMounted, ref } from "vue";
import type { Idetik } from "idetik";

type IdetikCore = typeof import("idetik");

export function useIdetikViewer(
  setup: (core: IdetikCore, canvas: HTMLCanvasElement) => Promise<Idetik>
) {
  const canvas = ref<HTMLCanvasElement | null>(null);
  let idetik: Idetik | null = null;
  let unmounted = false;

  function releaseContext(target: HTMLCanvasElement) {
    target
      .getContext("webgl2")
      ?.getExtension("WEBGL_lose_context")
      ?.loseContext();
  }

  onMounted(async () => {
    const target = canvas.value;
    if (!target) return;
    try {
      const instance = await setup(await import("idetik"), target);
      if (unmounted) {
        releaseContext(target);
        return;
      }
      idetik = instance.start();
    } catch (e) {
      console.error(e);
    }
  });

  onBeforeUnmount(() => {
    unmounted = true;
    if (!idetik) return;
    idetik.stop();
    if (canvas.value) releaseContext(canvas.value);
  });

  return canvas;
}
