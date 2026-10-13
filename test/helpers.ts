import type { Chunk } from "../src/data/chunk";
import { Viewport } from "@/core/viewport";
import { Layer } from "@/core/layer";
import { OrthographicCamera } from "@/objects/cameras/orthographic_camera";
import { ChunkManager } from "@/data/chunk_manager";
import type { IdetikContext } from "@/idetik";

type ChunkOverrides = Partial<
  Omit<Chunk, "shape" | "chunkIndex" | "scale" | "offset">
> & {
  shape?: Partial<Chunk["shape"]>;
  chunkIndex?: Partial<Chunk["chunkIndex"]>;
  scale?: Partial<Chunk["scale"]>;
  offset?: Partial<Chunk["offset"]>;
};

export function makeChunk(overrides: ChunkOverrides = {}): Chunk {
  const { shape, chunkIndex, scale, offset, ...rest } = overrides;

  const defaultChunk: Chunk = {
    state: "unloaded",
    lod: 0,
    visible: false,
    prefetch: false,
    priority: null,
    orderKey: null,
    shape: { x: 256, y: 256, z: 256, c: 1 },
    rowAlignmentBytes: 1,
    chunkIndex: { x: 0, y: 0, z: 0, c: 0, t: 0 },
    scale: { x: 1, y: 1, z: 1 },
    offset: { x: 0, y: 0, z: 0 },
  };

  const mergedShape = { ...defaultChunk.shape, ...(shape ?? {}) };

  return {
    ...defaultChunk,
    ...rest,
    shape: mergedShape,
    chunkIndex: { ...defaultChunk.chunkIndex, ...(chunkIndex ?? {}) },
    scale: { ...defaultChunk.scale, ...(scale ?? {}) },
    offset: { ...defaultChunk.offset, ...(offset ?? {}) },
  };
}

export function makeControllableLoader(onStart?: () => void) {
  const createAbortError = () => {
    const e = new Error("Cancelled");
    e.name = "AbortError";
    return e;
  };

  let _resolve: () => void;
  let _reject: (e: unknown) => void;

  const loader = (signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      _resolve = resolve;
      _reject = reject;
      onStart?.();

      const abort = () => reject(createAbortError());

      if (signal.aborted) {
        abort();
      } else {
        signal.addEventListener("abort", abort, { once: true });
      }
    });

  return {
    loader,
    resolve: () => _resolve?.(),
    reject: (e?: unknown) => _reject?.(e ?? new Error("test rejection")),
  };
}

export async function waitFor(
  check: () => boolean,
  { timeout = 500, interval = 5 } = {}
) {
  const start = Date.now();
  while (true) {
    if (check()) return;
    if (Date.now() - start > timeout) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, interval));
  }
}

export function createTestElement(id: string = "test-element"): HTMLElement {
  const element = document.createElement("div");
  element.id = id;
  return element;
}

export function createTestCamera(): OrthographicCamera {
  return new OrthographicCamera({ left: -1, right: 1, top: -1, bottom: 1 });
}

export function createTestContext(): IdetikContext {
  return { chunkManager: new ChunkManager() };
}

export class TrackingLayer extends Layer {
  public readonly type = "TrackingLayer";
  public attachCount = 0;
  public detachCount = 0;

  public update() {}

  protected attach() {
    this.attachCount++;
  }

  protected detach() {
    this.detachCount++;
  }
}

export function createTestViewport(id: string = "test-viewport"): Viewport {
  return new Viewport({
    id,
    domElement: createTestElement(id),
    camera: createTestCamera(),
  });
}
