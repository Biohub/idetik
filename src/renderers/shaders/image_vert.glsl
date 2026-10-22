#version 300 es

layout (location = 0) in vec3 a_position;
layout (location = 1) in vec3 a_normal;

uniform mat4 u_projection;
uniform mat4 u_modelView;
uniform mat4 u_model;
uniform mat4 u_worldToTexCoord;

out vec3 v_texCoords;

void main() {
    v_texCoords = (u_worldToTexCoord * u_model * vec4(a_position, 1.0)).xyz;
    gl_Position = u_projection * u_modelView * vec4(a_position, 1.0);
}
