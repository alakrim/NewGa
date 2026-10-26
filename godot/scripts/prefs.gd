class_name Prefs
extends RefCounted
## Small persisted UI preferences (selected hero, volumes) in user://ui.cfg.

const PATH := "user://ui.cfg"
static var _cfg: ConfigFile
static var _loaded := false


static func _load() -> void:
	if _loaded:
		return
	_loaded = true
	_cfg = ConfigFile.new()
	_cfg.load(PATH)


static func get_value(key: String, default: Variant) -> Variant:
	_load()
	return _cfg.get_value("ui", key, default)


static func set_value(key: String, value: Variant) -> void:
	_load()
	_cfg.set_value("ui", key, value)
	_cfg.save(PATH)
