import { Chunk } from "./chunk";
import { Logger } from "../utilities/logger";

type LoaderFn = (signal: AbortSignal) => Promise<void>;

type PendingItem = { chunk: Chunk; fn: LoaderFn };

type Ranked = Pick<Chunk, "priority" | "orderKey">;

export function comparePriority(a: Ranked, b: Ranked) {
  const priorityA = a.priority ?? Number.MAX_SAFE_INTEGER;
  const priorityB = b.priority ?? Number.MAX_SAFE_INTEGER;

  if (priorityA === priorityB) {
    return (
      (a.orderKey ?? Number.MAX_SAFE_INTEGER) -
      (b.orderKey ?? Number.MAX_SAFE_INTEGER)
    );
  }

  return priorityA - priorityB;
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

    this.pending_.sort((a, b) => comparePriority(a.chunk, b.chunk));

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
