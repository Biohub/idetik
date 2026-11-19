#version 300 es

#include ./common/srgb_to_linear.glsl

layout (location = 0) in vec3 a_position;
layout (location = 1) in vec3 a_normal;

uniform mat4 u_projection;
uniform mat4 u_modelView;
uniform vec3 u_wireframeColor;

flat out highp vec3 v_color;

void main() {
    v_color = srgbToLinear(u_wireframeColor);
    gl_Position = u_projection * u_modelView * vec4(a_position, 1.0);
}
