#version 300 es

#include ./common/srgb_to_linear.glsl

layout (location = 0) in vec3 a_position;
layout (location = 1) in vec3 a_normal;

uniform mat4 u_projection;
uniform mat4 u_modelView;
uniform mat4 u_model;
uniform vec3 u_color;

out vec3 v_normal;
flat out highp vec3 v_color;

void main() {
    v_color = srgbToLinear(u_color);
    v_normal = transpose(inverse(mat3(u_model))) * a_normal;
    gl_Position = u_projection * u_modelView * vec4(a_position, 1.0);
}
