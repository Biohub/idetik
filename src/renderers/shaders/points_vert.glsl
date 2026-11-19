#version 300 es

precision mediump float;

#include ./common/srgb_to_linear.glsl

layout (location = 0) in vec3 a_position;
layout (location = 6) in vec4 a_color;
layout (location = 7) in float a_size;
layout (location = 8) in float a_marker;

uniform mat4 u_projection;
uniform mat4 u_modelView;

out vec4 v_color;
flat out uint v_marker;


void main() {
    gl_Position = u_projection * u_modelView * vec4(a_position, 1.0);
    gl_PointSize = a_size;
    v_color = vec4(srgbToLinear(a_color.rgb), a_color.a);
    v_marker = uint(a_marker);
}

