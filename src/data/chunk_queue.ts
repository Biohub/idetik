import { Chunk, ChunkDemand } from "./chunk";
import { Logger } from "../utilities/logger";

type LoaderFn = (signal: AbortSignal) => Promise<void>;

type PendingItem = { chunk: Chunk; fn: LoaderFn };

// Orders by priority, then orderKey; chunks nobody wants sort last.
export function comparePriority(a: ChunkDemand | null, b: ChunkDemand | null) {
  if (a === null || b === null) {
    return Number(a === null) - Number(b === null);
  }
  return a.priority - b.priority || a.orderKey - b.orderKey;
}

export class ChunkQueue {
  private readonly maxConcurrent_: number;
  private readonly pending_: PendingItem[] = [];
  private readonly running_ = new Map<
    Chunk,
    { controller: AbortController; promise: Promise<void> }
  >();

  constructor(maxConcurrent: number) {
    this.maxConcurrent_ = Math.max(1, maxConcurrent);
  }

  public enqueue(chunk: Chunk, fn: LoaderFn) {
    if (this.running_.has(chunk)) return;
    if (this.pending_.some((p) => p.chunk === chunk)) return;

    this.pending_.push({ chunk, fn });
  }

  public flush() {
    this.pump();
  }

  public cancel(chunk: Chunk) {
    const idx = this.pending_.findIndex((p) => p.chunk === chunk);
    if (idx >= 0) {
      this.pending_.splice(idx, 1);
      Logger.debug("ChunkQueue", "Cancelled pending request");
      return;
    }

    const running = this.running_.get(chunk);
    if (running) {
      running.controller.abort();
      Logger.debug("ChunkQueue", "Cancelled fetch request");
    }
  }

  public get pendingCount() {
    return this.pending_.length;
  }

  public get runningCount() {
    return this.running_.size;
  }

  private pump() {
    if (
      this.running_.size >= this.maxConcurrent_ ||
      this.pending_.length === 0
    ) {
      return;
    }

    this.pending_.sort((a, b) =>
      comparePriority(a.chunk.demand, b.chunk.demand)
    );

    while (
      this.running_.size < this.maxConcurrent_ &&
      this.pending_.length > 0
    ) {
      this.start(this.pending_.shift()!);
    }
  }

  private start(item: PendingItem) {
    const { chunk, fn } = item;
    chunk.state = "loading";

    const controller = new AbortController();
    const promise = Promise.resolve()
      .then(() => fn(controller.signal))
      .then(
        () => {
          if (chunk.state === "loading") chunk.state = "loaded";
        },
        (err) => {
          if (chunk.state === "loading") chunk.state = "unloaded";
          if (err.name !== "AbortError") {
            Logger.error("ChunkQueue", String(err));
          }
        }
      )
      .finally(() => {
        this.running_.delete(chunk);
        this.pump();
      });

    this.running_.set(chunk, { controller, promise });
  }
}
