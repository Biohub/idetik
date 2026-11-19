#version 300 es
#pragma inject_defines

precision highp float;

#include ./common/srgb_to_linear.glsl

layout (location = 0) out vec4 fragColor;

#if defined TEXTURE_DATA_TYPE_INT
uniform mediump isampler3D u_imageSampler;
#elif defined TEXTURE_DATA_TYPE_UINT
uniform mediump usampler3D u_imageSampler;
#else
uniform mediump sampler3D u_imageSampler;
#endif

uniform vec3 u_color;
uniform float u_valueOffset;
uniform float u_valueScale;
uniform float u_opacity;
uniform bool u_premultiplyAlpha;

in vec3 v_texCoords;

void main() {
    float texel = float(texture(u_imageSampler, v_texCoords).r);
    float value = (texel + u_valueOffset) * u_valueScale;
    vec3 displayColor = clamp(value * u_color, 0.0, 1.0);
    fragColor = vec4(srgbToLinear(displayColor), u_opacity);
    if (u_premultiplyAlpha) fragColor.rgb *= fragColor.a;
}
