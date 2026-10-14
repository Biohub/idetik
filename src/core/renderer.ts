import { Camera } from "../objects/cameras/camera";
import { Layer } from "./layer";
import { RenderableObject } from "./renderable_object";
import { Viewport } from "./viewport";
import { Texture } from "../objects/textures/texture";

export type GpuTiming = {
  supported: boolean;
  samples: number;
  totalMs: number;
  lastSampleAt?: number;
};

export abstract class Renderer {
  private readonly canvas_: HTMLCanvasElement | null;
  private width_ = 0;
  private height_ = 0;

  protected renderedObjects_ = 0;
  protected abstract resize(width: number, height: number): void;
  protected abstract renderObject(
    layer: Layer,
    object: RenderableObject,
    camera: Camera
  ): void;
  protected abstract clear(): void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas_ = canvas;
    this.updateRendererSize();
  }

  public abstract beginFrame(): void;

  public abstract endFrame(): void;

  public abstract resetGpuTiming(): void;

  public abstract get gpuTiming(): GpuTiming;

  public abstract render(viewport: Viewport): void;

  public updateSize(): void {
    this.updateRendererSize();
    this.resize(this.width_, this.height_);
  }

  private updateRendererSize() {
    this.width_ = this.canvas.clientWidth * window.devicePixelRatio;
    this.height_ = this.canvas.clientHeight * window.devicePixelRatio;

    if (this.canvas.width !== this.width_) this.canvas.width = this.width_;
    if (this.canvas.height !== this.height_) this.canvas.height = this.height_;
  }

  protected get canvas() {
    return this.canvas_!;
  }

  public get width() {
    return this.width_;
  }

  public get height() {
    return this.height_;
  }

  public get renderedObjects() {
    return this.renderedObjects_;
  }

  public abstract get gpuTextureBytes(): number;

  public abstract get gpuTextureCount(): number;

  public abstract uploadTexture(texture: Texture): void;

  public abstract disposeTexture(texture: Texture): void;
}
