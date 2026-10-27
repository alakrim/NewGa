// Stylised pixel water: base colour, drifting light streaks and animated foam where it meets the island.
shader_type spatial;
render_mode specular_disabled, unshaded;

uniform vec4 base : source_color = vec4(0.278, 0.67, 0.663, 1.0);
uniform vec4 deep : source_color = vec4(0.2, 0.52, 0.56, 1.0);
uniform vec4 foam : source_color = vec4(0.86, 0.97, 0.93, 1.0);
uniform vec4 island = vec4(-100.0, -36.0, 98.0, 18.0); // x0, z0, x1, z1

varying vec3 wp;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void vertex() {
	wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 q = floor(wp.xz * 16.0) / 16.0;
	vec2 d2 = max(vec2(island.x, island.y) - q, q - vec2(island.z, island.w));
	float d = length(max(d2, 0.0));
	vec3 c = mix(base.rgb, deep.rgb, smoothstep(2.0, 30.0, d));
	float streak = vnoise(vec2(q.x * 0.35 + TIME * 0.25, q.y * 2.2 - TIME * 0.1));
	c = mix(c, foam.rgb, step(0.86, streak) * 0.35);
	float band = 0.55 + 0.25 * sin(TIME * 1.6 + q.x * 0.6 + q.y * 0.6) + (vnoise(q * 1.7 + TIME * 0.4) - 0.5) * 0.5;
	if (d < band) c = foam.rgb;
	else if (d < band + 0.35) c = mix(c, foam.rgb, 0.45);
	ALBEDO = c;
}
