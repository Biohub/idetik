export type Deferred = {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
};

export function settle(deferreds: Iterable<Deferred>, error?: Error): void {
  for (const { resolve, reject, timeout } of deferreds) {
    clearTimeout(timeout);
    if (error) reject(error);
    else resolve();
  }
}
