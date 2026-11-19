#version 300 es

precision mediump float;

layout (location = 0) out vec4 fragColor;

uniform float u_opacity;

flat in highp vec3 v_color;

void main() {
    fragColor = vec4(v_color, u_opacity);
}
