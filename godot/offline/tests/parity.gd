extends SceneTree
## Parity check for the offline engine: plays the same seeded Frontline bot match as tools/offline-parity.ts and
## writes the same per-tick digest, so tools/offline-parity-compare.mjs can find the first tick that differs.
##   godot --headless --path godot -s res://offline/tests/parity.gd -- --seed=1 --ticks=1200 --out=/tmp/gd.txt
## Prints the engine's average cost per tick too.

const Game = preload("res://offline/engine/game.gd")
const Data = preload("res://offline/engine/data.gd")


func _f6(v: float) -> String:
	return "%.6f" % (v + 0.0)


func _digest(g) -> String:
	var parts := PackedStringArray([str(g.tick), "r%d" % g.rng_calls])
	for u in g.units.values():
		parts.append("%d:%s:%s:%s:%s:%d" % [u.id, u.kind, _f6(u.x), _f6(u.z), _f6(u.hp), 1 if u.dead else 0])
	for u in g.units.values():
		if u.hero:
			parts.append("g%d:%s:%d" % [u.id, _f6(u.hero.gold), u.hero.level])
	parts.append("p%d" % g.projectiles.size())
	parts.append("z%d" % g.zones.size())
	parts.append("w%s" % (str(g.winner) if g.winner != null else "-"))
	return " ".join(parts)


func _init() -> void:
	var seed := 1
	var ticks := 1200
	var out := "user://parity-gd.txt"
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--seed="):
			seed = int(a.substr(7))
		elif a.begins_with("--ticks="):
			ticks = int(a.substr(8))
		elif a.begins_with("--out="):
			out = a.substr(6)
	var D := Data.get_data()
	var setups := []
	for i in 4:
		setups.append({"pid": "b%d" % i, "name": "B%d" % i, "team": i % 2, "heroId": D.heroes[(seed * 7 + i * 5) % D.heroes.size()].id, "bot": true})
	var g = Game.new(setups, seed)
	g.rng_calls = 0  # the TypeScript reference counts from after construction
	var lines := PackedStringArray([_digest(g)])
	var t0 := Time.get_ticks_usec()
	var n := 0
	while n < ticks and g.winner == null:
		g.step()
		g.flush_events()
		lines.append(_digest(g))
		n += 1
	var us := Time.get_ticks_usec() - t0
	var f := FileAccess.open(out, FileAccess.WRITE)
	f.store_string("\n".join(lines) + "\n")
	f.close()
	print("parity: %d ticks, %.3f ms per tick (digest included), units %d" % [n, us / 1000.0 / maxf(1, n), g.units.size()])
	quit()
