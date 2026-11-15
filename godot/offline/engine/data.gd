extends RefCounted
## Game data for the offline engine: godot/offline/data.json, exported from the TypeScript sources by
## tools/gen-offline-data.ts (never edited by hand), loaded once.

const PATH := "res://offline/data.json"
static var _d: Dictionary = {}


static func get_data() -> Dictionary:
	if _d.is_empty():
		var txt := FileAccess.get_file_as_string(PATH)
		var parsed = JSON.parse_string(txt)
		if parsed is Dictionary:
			_d = parsed
			var by_id := {}
			for h in _d.heroes:
				by_id[h.id] = h
			_d["hero_by_id"] = by_id
		else:
			push_error("offline engine: cannot read " + PATH)
	return _d
