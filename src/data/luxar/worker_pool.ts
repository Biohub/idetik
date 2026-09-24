import type { PackedSplats } from "./decode";
import type { LuxarDecodeRequest, LuxarDecodeResponse } from "./worker";
// "inline" import to ensure worker code works in dependent projects
// see https://github.com/vitejs/vite/issues/11672
import LuxarWorker from "./worker.ts?worker&inline";

type Pending = {
  resolve: (splats: PackedSplats) => void;
  reject: (error: Error) => void;
  worker: WorkerSlot;
};

type WorkerSlot = {
  worker: Worker;
  pending: number;
};

export class LuxarWorkerPool {
  private readonly slots_: WorkerSlot[] = [];
  private readonly pending_ = new Map<number, Pending>();
  private readonly size_: number;
  private nextId_ = 0;

  constructor(size: number) {
    this.size_ = Math.max(1, size);
  }

  public decode(request: Omit<LuxarDecodeRequest, "id">) {
    const id = this.nextId_++;
    const slot = this.acquire();
    slot.pending++;
    return new Promise<PackedSplats>((resolve, reject) => {
      this.pending_.set(id, { resolve, reject, worker: slot });
      slot.worker.postMessage({ ...request, id });
    });
  }

  public terminate() {
    for (const slot of this.slots_) slot.worker.terminate();
    this.slots_.length = 0;
    for (const pending of this.pending_.values()) {
      pending.reject(new Error("Worker pool terminated"));
    }
    this.pending_.clear();
  }

  private acquire(): WorkerSlot {
    const idle = this.slots_.find((slot) => slot.pending === 0);
    if (idle) return idle;
    if (this.slots_.length < this.size_) {
      const worker = new LuxarWorker();
      const slot = { worker, pending: 0 };
      worker.addEventListener(
        "message",
        (e: MessageEvent<LuxarDecodeResponse>) => this.onMessage(e.data)
      );
      worker.addEventListener("error", (e) => this.onError(slot, e));
      this.slots_.push(slot);
      return slot;
    }
    return this.slots_.reduce((a, b) => (b.pending < a.pending ? b : a));
  }

  private onMessage(response: LuxarDecodeResponse) {
    const pending = this.pending_.get(response.id);
    if (!pending) return;
    this.pending_.delete(response.id);
    pending.worker.pending--;
    if (response.success) {
      pending.resolve(response.splats);
    } else {
      pending.reject(new Error(response.error));
    }
  }

  private onError(slot: WorkerSlot, event: ErrorEvent) {
    for (const [id, pending] of this.pending_) {
      if (pending.worker !== slot) continue;
      pending.reject(new Error(`Luxar worker error: ${event.message}`));
      this.pending_.delete(id);
    }
    slot.worker.terminate();
    this.slots_.splice(this.slots_.indexOf(slot), 1);
  }
}
