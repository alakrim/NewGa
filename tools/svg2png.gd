extends SceneTree
## Renders the game-icons.net SVGs in public/icons to white 128px PNGs for the Godot client (godot/assets/icons).
## Run:  godot --headless --path godot -s ../tools/svg2png.gd
## The icons are CC BY 3.0 (see public/icons/LICENSE.md); the client's Settings screen carries the credits.

func _init() -> void:
	var src := ProjectSettings.globalize_path("res://").path_join("../public/icons")
	var dst := ProjectSettings.globalize_path("res://assets/icons")
	DirAccess.make_dir_recursive_absolute(dst)
	var d := DirAccess.open(src)
	var n := 0
	for f in d.get_files():
		if not f.ends_with(".svg"):
			continue
		var svg := FileAccess.get_file_as_string(src.path_join(f)).replace("currentColor", "#ffffff")
		var img := Image.new()
		if img.load_svg_from_string(svg, 0.25) == OK:
			img.save_png(dst.path_join(f.get_basename() + ".png"))
			n += 1
	print("rendered %d icons" % n)
	quit()
