import type { GpuTiming } from "../core/renderer";

type TimerExtension = {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
};

type PendingQuery = {
  query: WebGLQuery;
  submittedAt: number;
};

export class WebGLTimer {
  private extension_: TimerExtension | null;
  private activeQuery_: WebGLQuery | null = null;
  private pendingQuery_: PendingQuery | null = null;
  private samples_ = 0;
  private totalMs_ = 0;
  private lastSampleAt_: number | undefined;

  constructor(private readonly gl_: WebGL2RenderingContext) {
    this.extension_ = gl_.getExtension("EXT_disjoint_timer_query_webgl2");

    gl_.canvas.addEventListener("webglcontextlost", () => {
      this.extension_ = null;
      this.activeQuery_ = null;
      this.pendingQuery_ = null;
      this.lastSampleAt_ = undefined;
    });

    gl_.canvas.addEventListener("webglcontextrestored", () => {
      this.extension_ = gl_.getExtension("EXT_disjoint_timer_query_webgl2");
    });
  }

  public get timing(): GpuTiming {
    this.poll();
    return {
      supported: this.extension_ !== null && !this.gl_.isContextLost(),
      samples: this.samples_,
      totalMs: this.totalMs_,
      lastSampleAt: this.lastSampleAt_,
    };
  }

  public beginFrame() {
    this.discardActiveQuery();
    this.poll();
    if (!this.extension_ || this.gl_.isContextLost() || this.pendingQuery_) {
      return;
    }

    if (this.gl_.getParameter(this.extension_.GPU_DISJOINT_EXT)) {
      this.lastSampleAt_ = undefined;
      return;
    }

    const query = this.gl_.createQuery();
    if (!query) return;

    this.gl_.beginQuery(this.extension_.TIME_ELAPSED_EXT, query);
    this.activeQuery_ = query;
  }

  public endFrame() {
    if (!this.activeQuery_ || !this.extension_) return;

    this.gl_.endQuery(this.extension_.TIME_ELAPSED_EXT);
    this.pendingQuery_ = {
      query: this.activeQuery_,
      submittedAt: performance.now(),
    };
    this.activeQuery_ = null;
  }

  public reset() {
    this.discardActiveQuery();
    this.discardPendingQuery();
    this.lastSampleAt_ = undefined;
  }

  private poll() {
    const pending = this.pendingQuery_;
    if (!pending || !this.extension_ || this.gl_.isContextLost()) return;

    if (this.gl_.getParameter(this.extension_.GPU_DISJOINT_EXT)) {
      this.discardPendingQuery();
      this.lastSampleAt_ = undefined;
      return;
    }

    const { query, submittedAt } = pending;
    const gl = this.gl_;
    const ready = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE);
    if (!ready) return;

    const elapsedNs = gl.getQueryParameter(query, gl.QUERY_RESULT);
    if (!gl.isContextLost()) {
      this.samples_ += 1;
      this.totalMs_ += elapsedNs / 1e6;
      this.lastSampleAt_ = submittedAt;
    }

    this.discardPendingQuery();
  }

  private discardActiveQuery() {
    if (!this.activeQuery_ || !this.extension_) return;

    this.gl_.endQuery(this.extension_.TIME_ELAPSED_EXT);
    this.gl_.deleteQuery(this.activeQuery_);
    this.activeQuery_ = null;
  }

  private discardPendingQuery() {
    if (!this.pendingQuery_) return;

    this.gl_.deleteQuery(this.pendingQuery_.query);
    this.pendingQuery_ = null;
  }
}
