// Ground cover (grass blades, flowers, tufts): camera-facing quads lit like the ground, swaying in the wind.
shader_type spatial;
render_mode cull_disabled, specular_disabled;

uniform sampler2D tex : source_color, filter_nearest;
uniform float wind = 0.06;

void vertex() {
	vec3 o = (MODEL_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	float top = 1.0 - UV.y;
	VERTEX.x += sin(TIME * 1.8 + o.x * 0.45 + o.z * 0.25) * wind * top * (1.0 + 0.5 * sin(TIME * 0.7 + o.x * 0.1));
	NORMAL = vec3(0.0, 1.0, 0.0);
}

void fragment() {
	vec4 t = texture(tex, UV);
	ALBEDO = t.rgb * COLOR.rgb;
	ALPHA = t.a;
	ALPHA_SCISSOR_THRESHOLD = 0.5;
}
