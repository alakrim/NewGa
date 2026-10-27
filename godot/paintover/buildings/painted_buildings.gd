extends RefCounted
## Painted buildings: swaps a BuildingView's KayKit model for its painting (buildings/<bid>.png) on a quad
## that faces the orthographic camera. The quad's lower edge sits on the ground in front of the building and
## the painting's footprint centre lands on the building's position, so it covers its plot as painted.
## Construction stages and rubble keep their models.

const PITCH := 52.0
## Width of the painting in world units, and how far above its lower edge the footprint centre is (as a
## share of the width).
const WIDTH := {"castle": 14.0, "watchtower": 4.0, "tower": 3.4}
const ANCHOR := {"castle": 0.32}
const HUES := {"red": [0.0, 1.0], "purple": [0.78, 1.0], "yellow": [0.12, 1.25]}

static var _tex := {}
static var _shader: Shader


static func apply(b: Node3D) -> bool:
	var path := "res://paintover/buildings/%s.png" % b.bid
	if b.dead or b.progress < 1.0 or not FileAccess.file_exists(path):
		return false
	if not _tex.has(b.bid):
		var img := Image.load_from_file(ProjectSettings.globalize_path(path))
		img.generate_mipmaps()
		_tex[b.bid] = ImageTexture.create_from_image(img)
	if _shader == null:
		_shader = load("res://paintover/buildings/building.gdshader")
	var tex: Texture2D = _tex[b.bid]
	var w: float = WIDTH.get(b.bid, 5.4)
	var h := w * float(tex.get_height()) / float(tex.get_width())
	var a: float = w * ANCHOR.get(b.bid, 0.3)
	var r := deg_to_rad(PITCH)
	var toward_cam := Vector3(0, sin(r), cos(r))
	var up := Vector3(0, cos(r), -sin(r))
	# slide toward the camera along the ray through the building's position until the lower edge clears
	# the ground; the painting stays in the same place on screen
	var t := a * cos(r) / sin(r) + 0.05
	var q := QuadMesh.new()
	q.size = Vector2(w, h)
	var mat := ShaderMaterial.new()
	mat.shader = _shader
	mat.set_shader_parameter("tex", tex)
	var hue: Array = HUES.get(b.color, [-1.0, 1.0])
	mat.set_shader_parameter("target_hue", hue[0])
	mat.set_shader_parameter("target_value", hue[1])
	var mi := MeshInstance3D.new()
	mi.mesh = q
	mi.material_override = mat
	mi.transform = Transform3D(Basis(Vector3.RIGHT, up, toward_cam), toward_cam * t + up * (h / 2.0 - a))
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	for c in b.get_children():
		if c is Node3D:
			c.visible = false
	b.add_child(mi)
	return true
