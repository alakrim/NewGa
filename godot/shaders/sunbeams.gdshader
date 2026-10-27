// Screen-space golden-hour light shafts: soft diagonal beams from the upper left that drift slowly.
shader_type canvas_item;
render_mode blend_add, unshaded;

uniform vec4 tint : source_color = vec4(1.0, 0.82, 0.5, 1.0);
uniform float strength = 0.11;

float hash(float n) { return fract(sin(n) * 43758.5453); }
float noise(float x) {
	float i = floor(x);
	float f = fract(x);
	f = f * f * (3.0 - 2.0 * f);
	return mix(hash(i), hash(i + 1.0), f);
}

void fragment() {
	vec2 uv = SCREEN_UV;
	// coordinate across the beams (they run from upper left to lower right)
	float across = uv.x * 0.8 - uv.y * 0.55;
	float along = uv.x * 0.55 + uv.y * 0.8;
	float b = noise(across * 9.0 + TIME * 0.05) * noise(across * 23.0 - TIME * 0.08 + 4.0);
	b = smoothstep(0.18, 0.75, b);
	float fade = smoothstep(1.25, 0.0, along) * smoothstep(-0.1, 0.25, along);
	COLOR = vec4(tint.rgb * b * fade * strength, 1.0);
}
