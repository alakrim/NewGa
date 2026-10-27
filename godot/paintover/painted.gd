extends "res://tests/hd2d.gd"
## Paint-over experiment, step 3: the staged battle from tests/hd2d.gd, but the battlefield is the block map
## with the stitched painting projected onto it (projection.gdshader) and the camera is orthographic.
## Screenshots go to $VT_SHOTS as po-*.png.

const Blockout = preload("res://paintover/blockout.gd")


func _ready() -> void:
	game = Game.new()
	game.ortho = true
	add_child(game)
	world = game.world
	_paint_world()
	_stage()
	_run()


## Drops the game's own terrain, ground cover, trees and props, keeps light, water, fireflies, braziers and
## actors, and builds the painted blocks in their place.
func _paint_world() -> void:
	for c in world.get_children():
		var keep: bool = c == world.actors or c is WorldEnvironment or c is DirectionalLight3D or c is OmniLight3D \
			or c is GPUParticles3D or (c is AnimatedSprite3D and not c.shaded)
		if c is MeshInstance3D and c.material_override is ShaderMaterial and c.material_override.shader.resource_path.ends_with("water.gdshader"):
			keep = true
		if not keep:
			c.queue_free()
	var img := Image.load_from_file(ProjectSettings.globalize_path("res://paintover/pano.jpg"))
	img.generate_mipmaps()
	var mat := ShaderMaterial.new()
	mat.shader = load("res://paintover/projection.gdshader")
	mat.set_shader_parameter("pano", ImageTexture.create_from_image(img))
	var env: Environment = world.environment
	mat.set_shader_parameter("ambient", Vector3(env.ambient_light_color.r, env.ambient_light_color.g, env.ambient_light_color.b) * env.ambient_light_energy)
	var blocks := Node3D.new()
	blocks.name = "PaintedBlocks"
	world.add_child(blocks)
	Blockout.new().build(blocks, func(k): return null if k == "water" else mat)
	for b in blocks.get_children():
		b.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF  # the painting has their shadows


func _shot(name: String) -> void:
	await get_tree().create_timer(0.6).timeout
	await get_tree().process_frame
	await get_tree().process_frame
	var dir := OS.get_environment("VT_SHOTS")
	if dir == "":
		dir = ProjectSettings.globalize_path("user://shots")
	DirAccess.make_dir_recursive_absolute(dir)
	get_viewport().get_texture().get_image().save_png(dir.path_join("po-%s.png" % name))
	print("shot ", name)


func _run() -> void:
	await get_tree().create_timer(1.5).timeout
	look(0, -3)
	await _shot("1-fight")
	look(-66, -6)
	await _shot("2-blue-base")
	look(40, -4, 0.6)
	await _shot("3-wide")
	look(-2, -1, 1.35)
	await _shot("4-close")
	look(-52, 9, 1.0)
	await _shot("5-mines")
	look(78, -10, 0.7)
	await _shot("6-red-keep")
	get_tree().quit()
