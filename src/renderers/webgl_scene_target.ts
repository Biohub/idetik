export class WebGLSceneTarget {
  public readonly textureUnit: number;

  private readonly gl_: WebGL2RenderingContext;

  private framebuffer_: WebGLFramebuffer | null = null;
  private texture_: WebGLTexture | null = null;
  private depthStencil_: WebGLRenderbuffer | null = null;
  private width_ = 0;
  private height_ = 0;

  constructor(gl: WebGL2RenderingContext, textureUnit: number) {
    this.gl_ = gl;
    this.textureUnit = textureUnit;
  }

  public get texture(): WebGLTexture {
    if (!this.texture_) {
      throw new Error("Scene color texture has not been allocated");
    }
    return this.texture_;
  }

  public get width(): number {
    return this.width_;
  }

  public get height(): number {
    return this.height_;
  }

  public bind(width: number, height: number) {
    if (!this.hasValidTarget(width, height)) {
      this.createRenderTarget(width, height);
    }
    this.gl_.bindFramebuffer(this.gl_.FRAMEBUFFER, this.framebuffer_);
  }

  public unbind() {
    this.gl_.bindFramebuffer(this.gl_.FRAMEBUFFER, null);
  }

  public dispose() {
    if (this.framebuffer_) this.gl_.deleteFramebuffer(this.framebuffer_);
    if (this.texture_) this.gl_.deleteTexture(this.texture_);
    if (this.depthStencil_) this.gl_.deleteRenderbuffer(this.depthStencil_);

    this.framebuffer_ = null;
    this.texture_ = null;
    this.depthStencil_ = null;
    this.width_ = 0;
    this.height_ = 0;
  }

  private hasValidTarget(width: number, height: number) {
    return (
      this.texture_ !== null && this.width_ === width && this.height_ === height
    );
  }

  private createRenderTarget(width: number, height: number) {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0
    ) {
      throw new Error("Scene target dimensions must be positive integers");
    }

    const gl = this.gl_;
    this.dispose();

    try {
      this.framebuffer_ = gl.createFramebuffer();
      if (!this.framebuffer_) {
        throw new Error("Failed to create scene framebuffer");
      }

      this.texture_ = gl.createTexture();
      if (!this.texture_) {
        throw new Error("Failed to create scene color texture");
      }

      gl.activeTexture(gl.TEXTURE0 + this.textureUnit);
      gl.bindTexture(gl.TEXTURE_2D, this.texture_);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.SRGB8_ALPHA8, width, height);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      this.depthStencil_ = gl.createRenderbuffer();
      if (!this.depthStencil_) {
        throw new Error("Failed to create scene depth/stencil renderbuffer");
      }

      gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthStencil_);

      gl.renderbufferStorage(
        gl.RENDERBUFFER,
        gl.DEPTH24_STENCIL8,
        width,
        height
      );

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer_);

      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this.texture_,
        0
      );

      gl.framebufferRenderbuffer(
        gl.FRAMEBUFFER,
        gl.DEPTH_STENCIL_ATTACHMENT,
        gl.RENDERBUFFER,
        this.depthStencil_
      );

      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`Scene framebuffer is incomplete (status ${status})`);
      }

      this.width_ = width;
      this.height_ = height;
    } catch (error) {
      this.dispose();
      throw error;
    } finally {
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }
}
