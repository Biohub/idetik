import * as zarr from "zarrita";
import { Logger } from "../../utilities/logger";
import { ZarrArrayParams } from "../zarr/open";
import { isChunkData, ChunkData } from "../chunk";
import { ZarrWorkerRequest, ZarrWorkerResponse } from "./worker_kernel";
import { SliceSpec, processChunk } from "./chunk_processing";
// "inline" import to ensure worker code works in dependent projects
// this is a workaround for a vite limitation when building a library
// see https://github.com/vitejs/vite/issues/11672
import WorkerKernel from "./worker_kernel.ts?worker&inline";

type PendingGetChunkRequest = {
  resolve: (value: ChunkData) => void;
  reject: (error: Error) => void;
  abortListener?: () => void;
  abortSignal?: AbortSignal;
  workerId: number;
};

type WorkerInstance = {
  worker: Worker;
  pendingCount: number;
  workerId: number;
};

// leave 2 cores for the main thread and the OS/other tabs
const DEFAULT_WORKER_COUNT = Math.max(1, navigator.hardwareConcurrency - 2);
let workerPool: WorkerInstance[] = [];
let messageId = 0;
let workerId = 0;
const pendingMessages = new Map<number, PendingGetChunkRequest>();
const canceledMessages = new Set<number>();

function getWorkerInstance(worker: Worker): WorkerInstance | undefined {
  const instance = workerPool.find((w) => w.worker === worker);
  if (!instance) {
    Logger.error(
      "ZarrWorker",
      "Worker not found in pool - this should not happen"
    );
  }
  return instance;
}

function handleWorkerMessage(
  e: MessageEvent<ZarrWorkerResponse>,
  worker: Worker
): void {
  const { id, success } = e.data;
  const pending = pendingMessages.get(id);

  if (!pending) {
    if (canceledMessages.has(id)) {
      canceledMessages.delete(id);
    } else {
      Logger.warn(
        "ZarrWorker",
        `Received response for unknown message ID ${id}:`,
        e.data
      );
    }
    return;
  }

  pendingMessages.delete(id);

  if (pending.abortListener && pending.abortSignal) {
    pending.abortSignal.removeEventListener("abort", pending.abortListener);
  }

  const workerInstance = getWorkerInstance(worker);
  if (workerInstance && workerInstance.pendingCount > 0) {
    workerInstance.pendingCount--;
  } else if (workerInstance) {
    Logger.error(
      "ZarrWorker",
      "Received message but no pending tasks - this should not happen"
    );
  }

  if (success && e.data.type === "getChunk") {
    pending.resolve(e.data.data);
  } else if (!success) {
    pending.reject(new Error(e.data.error || "Unknown worker error"));
  }
}

function handleWorkerError(
  error: ErrorEvent | MessageEvent,
  worker: Worker
): void {
  if (error instanceof MessageEvent) {
    Logger.error(
      "ZarrWorker",
      "Message serialization error occurred - worker remains active"
    );
    return;
  }

  Logger.error(
    "ZarrWorker",
    `Worker failed - replacing worker and canceling its in-flight messages`,
    error.message
  );

  const workerInstance = getWorkerInstance(worker);
  if (workerInstance) {
    const workerIndex = workerPool.indexOf(workerInstance);
    workerPool.splice(workerIndex, 1);
  }

  const failedWorkerId = workerInstance?.workerId;
  if (failedWorkerId !== undefined) {
    for (const [id, pending] of pendingMessages.entries()) {
      if (pending.workerId === failedWorkerId) {
        pending.reject(new Error(`Worker error: ${error.message}`));
        pendingMessages.delete(id);
      }
    }
  }

  try {
    const replacementWorker = createWorker();
    workerPool.push({
      worker: replacementWorker,
      pendingCount: 0,
      workerId: workerId++,
    });
    Logger.debug("ZarrWorker", "Replacement worker created successfully");
  } catch (err) {
    Logger.error("ZarrWorker", "Failed to create replacement worker", err);
  }
}

function createWorker(): Worker {
  const worker = new WorkerKernel();

  worker.addEventListener("message", (e) => handleWorkerMessage(e, worker));
  worker.addEventListener("error", (error) => handleWorkerError(error, worker));
  worker.addEventListener("messageerror", (error) =>
    handleWorkerError(error, worker)
  );

  return worker;
}

function getLeastBusyWorker(): WorkerInstance {
  if (workerPool.length === 0) {
    throw new Error("Worker pool is not initialized");
  }
  return workerPool.sort((a, b) => a.pendingCount - b.pendingCount)[0];
}

async function fetchAndProcessChunkInWorker(
  zarrParams: ZarrArrayParams,
  chunkIndex: number[],
  sliceSpec: SliceSpec,
  options?: { signal?: AbortSignal }
): Promise<ChunkData> {
  return new Promise((resolve, reject) => {
    const workerInstance = getLeastBusyWorker();

    const id = messageId++;
    const pending: PendingGetChunkRequest = {
      resolve,
      reject,
      workerId: workerInstance.workerId,
    };
    pendingMessages.set(id, pending);

    // set up cancellation in the worker thread if an AbortSignal is provided
    if (options?.signal) {
      const abortListener = () => {
        workerInstance.worker.postMessage({
          id: id,
          type: "cancel",
        } as ZarrWorkerRequest);

        pendingMessages.delete(id);
        canceledMessages.add(id);

        workerInstance.pendingCount--;

        reject(new DOMException("Operation was aborted", "AbortError"));
      };

      if (options.signal.aborted) {
        abortListener();
        // delete now, message canceled before it was even posted
        canceledMessages.delete(id);
        return;
      }

      options.signal.addEventListener("abort", abortListener, { once: true });

      pending.abortListener = abortListener;
      pending.abortSignal = options.signal;
    }

    workerInstance.pendingCount++;

    workerInstance.worker.postMessage({
      id: id,
      type: "getChunk",
      arrayParams: zarrParams,
      index: chunkIndex,
      sliceSpec,
    } as ZarrWorkerRequest);
  });
}

function ensureWorkerPool(): void {
  if (workerPool.length > 0) return;

  try {
    for (let i = 0; i < DEFAULT_WORKER_COUNT; i++) {
      const worker = createWorker();
      workerPool.push({
        worker,
        pendingCount: 0,
        workerId: workerId++,
      });
    }
    Logger.debug(
      "ZarrWorker",
      `Initialized worker pool with ${workerPool.length} workers`
    );
  } catch {
    Logger.warn("ZarrWorker", "Failed to create workers - clearing pool");
    terminateWorkerPool();
    return;
  }
}

export async function fetchAndProcessChunk(
  array: zarr.Array<zarr.DataType, zarr.Readable>,
  arrayParams: ZarrArrayParams | null,
  chunkCoords: number[],
  sliceSpec: SliceSpec,
  options?: { signal?: AbortSignal }
): Promise<ChunkData> {
  // Stores a worker can't open (see createZarrArrayParams) read here.
  if (arrayParams === null) {
    return fetchAndProcessChunkOnMainThread(
      array,
      chunkCoords,
      sliceSpec,
      options
    );
  }
  ensureWorkerPool();
  try {
    return await fetchAndProcessChunkInWorker(
      arrayParams,
      chunkCoords,
      sliceSpec,
      options
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    Logger.warn("ZarrWorker", "Falling back to main thread", error);
    return fetchAndProcessChunkOnMainThread(
      array,
      chunkCoords,
      sliceSpec,
      options
    );
  }
}

async function fetchAndProcessChunkOnMainThread(
  array: zarr.Array<zarr.DataType, zarr.Readable>,
  chunkCoords: number[],
  sliceSpec: SliceSpec,
  options?: { signal?: AbortSignal }
): Promise<ChunkData> {
  const rawChunk = await array.getChunk(chunkCoords, options);
  if (!isChunkData(rawChunk.data)) {
    throw new Error(
      `Unsupported chunk data type: ${rawChunk.data.constructor.name}`
    );
  }
  return processChunk(
    rawChunk.data,
    rawChunk.shape,
    rawChunk.stride,
    sliceSpec
  );
}

export function terminateWorkerPool(): void {
  for (const workerInstance of workerPool) {
    workerInstance.worker.terminate();
  }
  workerPool = [];
  pendingMessages.clear();
}
