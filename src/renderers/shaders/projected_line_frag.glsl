#version 300 es

precision mediump float;

layout (location = 0) out vec4 fragColor;

uniform vec3 u_lineColor;
uniform float u_opacity;
uniform bool u_premultiplyAlpha;

void main() {
    fragColor = vec4(u_lineColor, u_opacity);
    if (u_premultiplyAlpha) fragColor.rgb *= fragColor.a;
}
