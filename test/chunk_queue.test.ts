import { describe, expect, test } from "vitest";
import { ChunkQueue } from "@/data/chunk_queue";
import { makeChunk, makeControllableLoader, waitFor } from "./helpers";

async function expectCounts(
  queue: ChunkQueue,
  count: { pending: number; running: number }
) {
  await waitFor(
    () =>
      queue.pendingCount === count.pending &&
      queue.runningCount === count.running
  );
  expect(queue.pendingCount).toBe(count.pending);
  expect(queue.runningCount).toBe(count.running);
}

describe("ChunkQueue", () => {
  test("successful load sets state to loaded", async () => {
    const queue = new ChunkQueue(8);
    const ctl = makeControllableLoader();
    const chunk = makeChunk({ state: "queued", demand: { priority: 0 } });

    queue.enqueue(chunk, ctl.loader);
    expect(queue.pendingCount).toBe(1);

    queue.flush();
    await expectCounts(queue, { pending: 0, running: 1 });
    expect(chunk.state).toBe("loading");

    ctl.resolve();
    await expectCounts(queue, { pending: 0, running: 0 });
    expect(chunk.state).toBe("loaded");
  });

  test("starts up to max concurrent tasks and queues the rest", async () => {
    const maxConcurrent = 8;
    const queue = new ChunkQueue(maxConcurrent);
    const ctls = Array.from({ length: 10 }, () => makeControllableLoader());
    Array.from({ length: 10 }, () => makeChunk({ state: "queued" })).forEach(
      (chunk, i) => queue.enqueue(chunk, ctls[i].loader)
    );

    expect(queue.pendingCount).toBe(10);

    queue.flush();
    await expectCounts(queue, { pending: 2, running: maxConcurrent });

    ctls[0].resolve();
    await expectCounts(queue, { pending: 1, running: maxConcurrent });
  });

  test("respects priority ordering when starting", async () => {
    const queue = new ChunkQueue(8);

    const started: number[] = [];
    const ctl0 = makeControllableLoader(() => started.push(0));
    const ctl1 = makeControllableLoader(() => started.push(1));
    const ctl5 = makeControllableLoader(() => started.push(5));

    queue.enqueue(
      makeChunk({ state: "queued", demand: { priority: 5 } }),
      ctl5.loader
    );
    queue.enqueue(
      makeChunk({ state: "queued", demand: { priority: 1 } }),
      ctl1.loader
    );
    queue.enqueue(
      makeChunk({ state: "queued", demand: { priority: 0 } }),
      ctl0.loader
    );

    queue.flush();
    await expectCounts(queue, { pending: 0, running: 3 });
    expect(started).toEqual([0, 1, 5]);

    ctl0.resolve();
    ctl1.resolve();
    ctl5.resolve();
    await expectCounts(queue, { pending: 0, running: 0 });
  });

  test("backfills by priority when slots free up", async () => {
    const queue = new ChunkQueue(1);

    const started: number[] = [];
    const ctl0 = makeControllableLoader(() => started.push(0));
    const ctl1 = makeControllableLoader(() => started.push(1));
    const ctl5 = makeControllableLoader(() => started.push(5));

    queue.enqueue(
      makeChunk({ state: "queued", demand: { priority: 5 } }),
      ctl5.loader
    );
    queue.enqueue(
      makeChunk({ state: "queued", demand: { priority: 1 } }),
      ctl1.loader
    );
    queue.enqueue(
      makeChunk({ state: "queued", demand: { priority: 0 } }),
      ctl0.loader
    );

    queue.flush();
    await expectCounts(queue, { pending: 2, running: 1 });
    expect(started).toEqual([0]);

    ctl0.resolve();
    await expectCounts(queue, { pending: 1, running: 1 });
    expect(started).toEqual([0, 1]);

    ctl1.resolve();
    await expectCounts(queue, { pending: 0, running: 1 });
    expect(started).toEqual([0, 1, 5]);

    ctl5.resolve();
    await expectCounts(queue, { pending: 0, running: 0 });
  });

  test("tie-breaks by orderKey within equal priority", async () => {
    const queue = new ChunkQueue(8);

    const started: number[] = [];
    const ctl2 = makeControllableLoader(() => started.push(2));
    const ctl0 = makeControllableLoader(() => started.push(0));
    const ctl1 = makeControllableLoader(() => started.push(1));

    queue.enqueue(
      makeChunk({ state: "queued", demand: { priority: 1, orderKey: 2 } }),
      ctl2.loader
    );
    queue.enqueue(
      makeChunk({ state: "queued", demand: { priority: 1, orderKey: 0 } }),
      ctl0.loader
    );
    queue.enqueue(
      makeChunk({ state: "queued", demand: { priority: 1, orderKey: 1 } }),
      ctl1.loader
    );

    queue.flush();
    await expectCounts(queue, { pending: 0, running: 3 });
    expect(started).toEqual([0, 1, 2]);

    ctl0.resolve();
    ctl1.resolve();
    ctl2.resolve();
    await expectCounts(queue, { pending: 0, running: 0 });
  });

  test("does not process the same chunk twice", async () => {
    const queue = new ChunkQueue(8);
    const chunk = makeChunk({ state: "queued", demand: { priority: 0 } });

    const ctl = makeControllableLoader();
    queue.enqueue(chunk, ctl.loader);
    queue.enqueue(chunk, ctl.loader);
    queue.enqueue(chunk, ctl.loader);

    expect(queue.pendingCount).toBe(1);

    queue.flush();
    await expectCounts(queue, { pending: 0, running: 1 });
  });

  test("cancel pending request prevents it from starting", async () => {
    const queue = new ChunkQueue(1);

    const pendingChunk = makeChunk({
      state: "queued",
      demand: { priority: 0 },
    });
    const blockerChunk = makeChunk({
      state: "queued",
      demand: { priority: 0 },
    });
    const blockerCtl = makeControllableLoader();

    queue.enqueue(blockerChunk, blockerCtl.loader);
    queue.enqueue(pendingChunk, makeControllableLoader().loader);
    expect(queue.pendingCount).toBe(2);

    queue.flush();
    await expectCounts(queue, { pending: 1, running: 1 });

    queue.cancel(pendingChunk);

    blockerCtl.resolve();
    await expectCounts(queue, { pending: 0, running: 0 });
    expect(pendingChunk.state).toBe("queued");
  });

  test("cancel running request aborts and resets", async () => {
    const queue = new ChunkQueue(8);
    const ctl = makeControllableLoader();
    const chunk = makeChunk({ state: "queued" });

    queue.enqueue(chunk, ctl.loader);
    queue.flush();

    await expectCounts(queue, { pending: 0, running: 1 });
    expect(chunk.state).toBe("loading");

    queue.cancel(chunk);

    await expectCounts(queue, { pending: 0, running: 0 });
    expect(chunk.state).toBe("unloaded");

    // verify it can run again after cancel
    chunk.state = "queued";
    queue.enqueue(chunk, ctl.loader);
    queue.flush();

    await expectCounts(queue, { pending: 0, running: 1 });
    expect(chunk.state).toBe("loading");
  });
});
