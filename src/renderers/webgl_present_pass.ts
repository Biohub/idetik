import type { WebGLSceneTarget } from "./webgl_scene_target";
import { WebGLShaderProgram } from "./webgl_shader_program";
import fragmentShader from "./shaders/present_frag.glsl";
import vertexShader from "./shaders/present_vert.glsl";

export class WebGLPresentPass {
  private readonly gl_: WebGL2RenderingContext;
  private readonly program_: WebGLShaderProgram;
  private readonly vertexArray_: WebGLVertexArrayObject;

  constructor(gl: WebGL2RenderingContext) {
    this.gl_ = gl;
    this.program_ = new WebGLShaderProgram(gl, vertexShader, fragmentShader);

    const vertexArray = gl.createVertexArray();
    if (!vertexArray) {
      this.program_.dispose();
      throw new Error("Failed to create presentation vertex array");
    }

    this.vertexArray_ = vertexArray;
  }

  public render(sceneTarget: WebGLSceneTarget) {
    const gl = this.gl_;
    const texture = sceneTarget.texture;

    gl.activeTexture(gl.TEXTURE0 + sceneTarget.textureUnit);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    this.program_.use();
    this.program_.setUniform("u_sceneSampler", sceneTarget.textureUnit);

    gl.bindVertexArray(this.vertexArray_);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
