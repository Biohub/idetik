import { vec2 } from "gl-matrix";
import { Geometry } from "../core/geometry";
import { Box2 } from "../math/box2";
import { GeneratedTexture3D } from "../objects/textures/generated_texture_3d";
import { WebGLBuffers } from "./webgl_buffers";
import { WebGLShaderPrograms } from "./webgl_shader_programs";
import { WebGLState } from "./webgl_state";
import { WebGLTextures } from "./webgl_textures";

// Fills generated textures by rendering each z-slice of each mip level as
// a color attachment, with a fullscreen triangle per slice.
export class WebGLTextureGenerator {
  private readonly gl_: WebGL2RenderingContext;
  private readonly textures_: WebGLTextures;
  private readonly programs_: WebGLShaderPrograms;
  private readonly state_: WebGLState;
  private readonly bindings_: WebGLBuffers;
  private readonly fullscreenTriangle_: Geometry;
  private framebuffer_: WebGLFramebuffer | null = null;

  constructor(
    gl: WebGL2RenderingContext,
    textures: WebGLTextures,
    programs: WebGLShaderPrograms,
    state: WebGLState,
    bindings: WebGLBuffers
  ) {
    this.gl_ = gl;
    this.textures_ = textures;
    this.programs_ = programs;
    this.state_ = state;
    this.bindings_ = bindings;
    this.fullscreenTriangle_ = new Geometry(
      [-1, -1, 0, 3, -1, 0, -1, 3, 0],
      [0, 1, 2]
    );
    this.fullscreenTriangle_.addAttribute({
      type: "position",
      itemSize: 3,
      offset: 0,
    });
  }

  // Leaves the viewport, scissor and blend state changed.
  public generate(texture: GeneratedTexture3D) {
    for (const pass of texture.passes) {
      for (const input of pass.inputs) {
        if (input instanceof GeneratedTexture3D && input.needsUpdate) {
          this.generate(input);
        }
      }
    }

    const gl = this.gl_;
    const id = this.textures_.allocate(texture);
    // Lets the texture bind as an input to its own later levels.
    texture.needsUpdate = false;

    this.framebuffer_ ??= gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer_);
    this.state_.setScissorTest(false);
    this.state_.setStencilTest(false);
    this.state_.setDepthTesting(false);
    this.state_.setDepthMask(false);
    this.state_.setColorMask(true);
    this.state_.setCullFaceMode("none");
    this.state_.setBlendingMode("none");
    this.bindings_.bindGeometry(this.fullscreenTriangle_);

    texture.passes.forEach((pass, level) => {
      pass.inputs.forEach((input, unit) => {
        this.textures_.bindTexture(input, unit);
      });
      const previousUnit = pass.inputs.length;
      if (level > 0) {
        this.textures_.bindTexture(texture, previousUnit);
        gl.activeTexture(gl.TEXTURE0 + previousUnit);
        // Sampling only the level below keeps the attached level out of
        // the sampled range, which would otherwise be a feedback loop.
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_BASE_LEVEL, level - 1);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAX_LEVEL, level - 1);
      }

      const program = this.programs_.use(pass.programName);
      const uniforms: Record<string, unknown> = {
        ...pass.uniforms,
        u_level: level,
        u_previousLevel: previousUnit,
      };
      pass.inputs.forEach((_, unit) => (uniforms[`u_input${unit}`] = unit));
      for (const name of program.uniformNames) {
        if (name in uniforms && name !== "u_slice") {
          program.setUniform(name, uniforms[name]);
        }
      }

      const width = Math.max(1, texture.width >> level);
      const height = Math.max(1, texture.height >> level);
      const depth = Math.max(1, texture.depth >> level);
      this.state_.setViewport(
        new Box2(vec2.fromValues(0, 0), vec2.fromValues(width, height))
      );
      for (let z = 0; z < depth; ++z) {
        gl.framebufferTextureLayer(
          gl.FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          id,
          level,
          z
        );
        program.setUniform("u_slice", z);
        gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_INT, 0);
      }

      if (level > 0) {
        gl.activeTexture(gl.TEXTURE0 + previousUnit);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_BASE_LEVEL, 0);
        gl.texParameteri(
          gl.TEXTURE_3D,
          gl.TEXTURE_MAX_LEVEL,
          texture.mipmapLevels - 1
        );
      }
    });

    gl.framebufferTextureLayer(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      null,
      0,
      0
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    for (const pass of texture.passes) {
      for (const input of pass.inputs) {
        if (input instanceof GeneratedTexture3D && input.transient) {
          this.textures_.dispose(input);
          input.needsUpdate = true;
        }
      }
    }
  }
}
