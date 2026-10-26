extends Node
## Builds and caches SpriteFrames from Tiny Swords sprite sheets (one animation per row).

const Visuals = preload("res://scripts/visuals.gd")

var _frames: Dictionary = {}
var _tex: Dictionary = {}


func tex(path: String) -> Texture2D:
	if _tex.has(path):
		return _tex[path]
	var t: Texture2D = null
	if ResourceLoader.exists(path):
		t = load(path)
	else:
		push_warning("missing texture " + path)
	_tex[path] = t
	return t


## Resolves `{C}` (Capitalised colour) and `{c}` in a sheet path, trying a few known file-name quirks.
func sheet_path(pattern: String, color: String) -> String:
	var cap := color.capitalize()
	var p := pattern.replace("{C}", cap).replace("{c}", color)
	if ResourceLoader.exists(p):
		return p
	# fall back to any png in the folder (the pack has typos such as Archer_Purlple.png)
	var dir := p.get_base_dir()
	var d := DirAccess.open(dir)
	if d:
		for f in d.get_files():
			if f.ends_with(".png"):
				return dir + "/" + f
	return p


## SpriteFrames for a visual id ("swordsman", "miner", "hero_tank", ...) in a player colour.
func frames(id: String, color: String) -> SpriteFrames:
	var key := id + ":" + color
	if _frames.has(key):
		return _frames[key]
	var def: Dictionary = Visuals.UNITS.get(id, Visuals.UNITS["swordsman"])
	var sf := SpriteFrames.new()
	sf.remove_animation("default")
	for anim_name in def.anims:
		var a: Dictionary = def.anims[anim_name]
		var path := sheet_path(a.get("sheet", def.sheet), color)
		var t := tex(path)
		if t == null:
			continue
		var fs: Vector2i = a.get("frame", def.frame)
		sf.add_animation(anim_name)
		sf.set_animation_speed(anim_name, a.get("fps", 10.0))
		sf.set_animation_loop(anim_name, a.get("loop", true))
		var row: int = a.get("row", 0)
		var start: int = a.get("start", 0)
		for i in range(a.count):
			var at := AtlasTexture.new()
			at.atlas = t
			at.region = Rect2((start + i) * fs.x, row * fs.y, fs.x, fs.y)
			sf.add_frame(anim_name, at)
	_frames[key] = sf
	return sf


## Single-row effect animations (explosion, fire, dust, heal...).
func effect_frames(id: String) -> SpriteFrames:
	var key := "fx:" + id
	if _frames.has(key):
		return _frames[key]
	var def: Dictionary = Visuals.EFFECTS[id]
	var sf := SpriteFrames.new()
	sf.remove_animation("default")
	sf.add_animation("play")
	sf.set_animation_speed("play", def.get("fps", 14.0))
	sf.set_animation_loop("play", def.get("loop", false))
	var t := tex(def.sheet)
	if t:
		var fs: Vector2i = def.frame
		for i in range(def.count):
			var at := AtlasTexture.new()
			at.atlas = t
			at.region = Rect2(i * fs.x, def.get("row", 0) * fs.y, fs.x, fs.y)
			sf.add_frame("play", at)
	_frames[key] = sf
	return sf
