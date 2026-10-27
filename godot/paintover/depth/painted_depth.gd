extends "res://paintover/painted.gd"
## Depth paint-over, step 4: the west end of the battlefield as one free painting (depth/painting.jpg)
## projected onto a height field made from its own depth (depth/height.bin, see fit.py). Every vertex sits
## on the orthographic camera's ray through its pixel, so the painting fits from every camera position;
## trees, tents and rocks have real height, so units pass behind them. The staged battle from
## tests/hd2d.tscn is moved into this part of the map. Screenshots go to $VT_SHOTS as pd-*.png.

const RECT := Vector4(-115.5, 33.0, 87.0, 58.0)  # u0, v at the top, width, height (tiles.gd tile 0)
const GRID := Vector2i(480, 320)
const SHIFT := -46.0  # moves the staged units from the middle of the lane to this end


func _paint_world() -> void:
	_strip_world()
	var img := Image.load_from_file(ProjectSettings.globalize_path("res://paintover/depth/painting.jpg"))
	img.generate_mipmaps()
	var mat := ShaderMaterial.new()
	mat.shader = load("res://paintover/projection.gdshader")
	mat.set_shader_parameter("pano", ImageTexture.create_from_image(img))
	mat.set_shader_parameter("rect", RECT)
	mat.set_shader_parameter("fallback", Color(0.36, 0.2, 0.09))
	var env: Environment = world.environment
	mat.set_shader_parameter("ambient", Vector3(env.ambient_light_color.r, env.ambient_light_color.g, env.ambient_light_color.b) * env.ambient_light_energy)
	var mi := MeshInstance3D.new()
	mi.mesh = _height_mesh()
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF  # the painting has its shadows
	world.add_child(mi)
	# the rest of the map is not painted in this test: plain canopy colour beyond the painting
	var rest := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(400, 300)
	rest.mesh = pm
	rest.position = Vector3(0, -1.2, -10)
	rest.material_override = mat
	rest.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	world.add_child(rest)


## A grid over the view plane, each vertex raised to its height along the camera ray.
func _height_mesh() -> ArrayMesh:
	var f := FileAccess.open("res://paintover/depth/height.bin", FileAccess.READ)
	var h := f.get_buffer(GRID.x * GRID.y * 4).to_float32_array()
	var r := deg_to_rad(Tiles.PITCH)
	var verts := PackedVector3Array()
	var normals := PackedVector3Array()
	verts.resize(GRID.x * GRID.y)
	normals.resize(GRID.x * GRID.y)
	var toward_cam := Vector3(0, sin(r), cos(r))
	for j in range(GRID.y):
		var v := RECT.y - RECT.w * float(j) / float(GRID.y - 1)
		for i in range(GRID.x):
			var u := RECT.x + RECT.z * float(i) / float(GRID.x - 1)
			var y := h[j * GRID.x + i]
			verts[j * GRID.x + i] = Vector3(u, y, -v / sin(r) + y * cos(r) / sin(r))
			normals[j * GRID.x + i] = toward_cam
	var idx := PackedInt32Array()
	for j in range(GRID.y - 1):
		for i in range(GRID.x - 1):
			var a := j * GRID.x + i
			idx.append_array([a, a + 1, a + GRID.x, a + 1, a + GRID.x + 1, a + GRID.x])
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_INDEX] = idx
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return m


func _stage() -> void:
	super._stage()
	for u in _units:
		if u.position.z < 9.0:  # the miners already stand at this end's gold veins
			u.position.x += SHIFT


func _shot(name: String) -> void:
	await get_tree().create_timer(0.6).timeout
	await get_tree().process_frame
	await get_tree().process_frame
	var dir := OS.get_environment("VT_SHOTS")
	if dir == "":
		dir = ProjectSettings.globalize_path("user://shots")
	DirAccess.make_dir_recursive_absolute(dir)
	get_viewport().get_texture().get_image().save_png(dir.path_join("pd-%s.png" % name))
	print("shot ", name)


func _run() -> void:
	await get_tree().create_timer(1.5).timeout
	look(-46, -3)
	await _shot("1-fight")
	look(-72, -6)
	await _shot("2-keep")
	look(-62, -8, 0.55)
	await _shot("3-wide")
	look(-48, -1, 1.35)
	await _shot("4-close")
	look(-55, 9, 1.0)
	await _shot("5-mines")
	look(-62, -16, 0.9)
	await _shot("6-camp")
	get_tree().quit()
