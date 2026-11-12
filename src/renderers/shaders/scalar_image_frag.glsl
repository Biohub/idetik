#version 300 es
#pragma inject_defines

precision highp float;

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
    fragColor = vec4(value * u_color, u_opacity);
    if (u_premultiplyAlpha) {
        fragColor.rgb = clamp(fragColor.rgb, 0.0, 1.0) * fragColor.a;
    }
}
