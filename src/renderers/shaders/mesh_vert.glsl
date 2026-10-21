#version 300 es

layout (location = 0) in vec3 a_position;
layout (location = 1) in vec3 a_normal;

uniform mat4 u_projection;
uniform mat4 u_modelView;
uniform mat4 u_model;

out vec3 v_normal;

void main() {
    v_normal = transpose(inverse(mat3(u_model))) * a_normal;
    gl_Position = u_projection * u_modelView * vec4(a_position, 1.0);
}
