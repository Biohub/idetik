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
uniform bool u_hasColorMap;
uniform vec3 u_colorMap[32];
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

    if (u_hasColorMap) {
        float x = clamp(value, 0.0, 1.0) * 31.0;
        int i = min(int(x), 30);
        fragColor.rgb = mix(
            srgbToLinear(u_colorMap[i]),
            srgbToLinear(u_colorMap[i + 1]),
            x - float(i)
        );
    }

    if (u_premultiplyAlpha) fragColor.rgb *= fragColor.a;
}
