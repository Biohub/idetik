/// <reference lib="webworker" />

import * as zarr from "zarrita";
import { openArrayFromParams, WorkerZarrArrayParams } from "../zarr/open";
import { isChunkData, ChunkData } from "../chunk";
import { SliceSpec, processChunk } from "./chunk_processing";

type ZarrWorkerMessageType = "getChunk" | "cancel";

export type ZarrWorkerRequest = {
  id: number;
} & (
  | {
      type: "getChunk";
      arrayParams: WorkerZarrArrayParams;
      index: number[];
      sliceSpec: SliceSpec;
    }
  | {
      type: "cancel";
    }
);

export type ZarrWorkerResponse = {
  id: number;
} & (
  | {
      success: true;
      type: "getChunk";
      data: ChunkData;
    }
  | {
      success: false;
      type: ZarrWorkerMessageType;
      error: string;
    }
);

const arrayCache = new Map<string, zarr.Array<zarr.DataType, zarr.Readable>>();
const ARRAY_CACHE_LIMIT = 100;
const activeRequests = new Map<number, AbortController>();

self.addEventListener("message", async (e: MessageEvent<ZarrWorkerRequest>) => {
  const { id, type } = e.data;

  try {
    if (type === "getChunk") {
      const { arrayParams, index, sliceSpec } = e.data;
      await handleGetChunkMessage(id, arrayParams, index, sliceSpec);
    } else if (type === "cancel") {
      await handleCancelMessage(id);
    } else {
      throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    self.postMessage({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

async function handleCancelMessage(id: number): Promise<void> {
  const abortController = activeRequests.get(id);
  if (abortController) {
    abortController.abort();
    activeRequests.delete(id);
  }
}

async function handleGetChunkMessage(
  id: number,
  arrayParams: WorkerZarrArrayParams,
  index: number[],
  sliceSpec: SliceSpec
): Promise<void> {
  const abortController = new AbortController();
  activeRequests.set(id, abortController);

  const array = await getOrOpenArray(arrayParams);

  const fetchStart = performance.now();
  let chunk;
  try {
    chunk = await array.getChunk(index, { signal: abortController.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Operation was canceled");
    }
    throw new Error(
      `Failed to get chunk at index ${JSON.stringify(index)}: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    activeRequests.delete(id);
  }
  performance.measure("zarrFetch", { start: fetchStart });

  if (!isChunkData(chunk.data)) {
    throw new Error(
      `Unsupported chunk data type: ${chunk.data.constructor.name}`
    );
  }

  const sliceStart = performance.now();
  const data = processChunk(chunk.data, chunk.shape, chunk.stride, sliceSpec);
  performance.measure("processChunk", { start: sliceStart });

  try {
    self.postMessage({ id, success: true, type: "getChunk", data }, [
      data.buffer,
    ]);
  } catch (postError) {
    throw new Error(
      `Failed to send result: ${postError instanceof Error ? postError.message : String(postError)}`
    );
  }
}

// we need to open arrays in each worker since we can't transfer them
// workers cache opened arrays to avoid reopening for each chunk request
// this is a simple LRU cache relying on Map's insertion order to track usage
async function getOrOpenArray(
  params: WorkerZarrArrayParams
): Promise<zarr.Array<zarr.DataType, zarr.Readable>> {
  const cacheKey = getArrayCacheKey(params);
  let array = arrayCache.get(cacheKey);
  if (!array) {
    if (arrayCache.size >= ARRAY_CACHE_LIMIT) {
      const firstKey = arrayCache.keys().next().value;
      if (firstKey) arrayCache.delete(firstKey);
    }

    try {
      array = await openArrayFromParams(params);
      arrayCache.set(cacheKey, array);
    } catch (openError) {
      throw new Error(
        `Failed to open zarr array: ${openError instanceof Error ? openError.message : String(openError)}`
      );
    }
  } else {
    arrayCache.delete(cacheKey);
    arrayCache.set(cacheKey, array);
  }
  return array;
}

function getArrayCacheKey(params: WorkerZarrArrayParams): string {
  const storeKey = params.type === "filesystem" ? params.path : params.url;
  return `${params.type}::${storeKey}::${params.arrayPath}`;
}
