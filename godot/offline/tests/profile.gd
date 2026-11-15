extends SceneTree
## Where does a slow offline tick go? Times step(), snapshot() and the JSON round trip separately and lists the
## slowest ticks.  godot --headless --path godot -s res://offline/tests/profile.gd -- --seed=3
const Game = preload("res://offline/engine/game.gd")
const Data = preload("res://offline/engine/data.gd")

func _init() -> void:
	var seed := 3
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--seed="):
			seed = int(a.substr(7))
	var D := Data.get_data()
	var setups := []
	for i in 4:
		setups.append({"pid": "b%d" % i, "name": "B%d" % i, "team": i % 2, "heroId": D.heroes[(seed * 7 + i * 5) % D.heroes.size()].id, "bot": i != 0})
	var g = Game.new(setups, seed)
	var worst := []
	var tot := [0.0, 0.0, 0.0]
	var n := 0
	while g.winner == null and n < 30000:
		var t0 := Time.get_ticks_usec()
		g.step()
		var t1 := Time.get_ticks_usec()
		var s = g.snapshot("b0", 0)
		var t2 := Time.get_ticks_usec()
		var j = JSON.parse_string(JSON.stringify(s))
		var t3 := Time.get_ticks_usec()
		g.flush_events()
		tot[0] += t1 - t0
		tot[1] += t2 - t1
		tot[2] += t3 - t2
		worst.append([(t1 - t0) / 1000.0, (t2 - t1) / 1000.0, (t3 - t2) / 1000.0, n, g.units.size()])
		n += 1
	worst.sort_custom(func(a, b): return a[0] > b[0])
	print("ticks %d  avg ms: step %.3f  snapshot %.3f  json %.3f" % [n, tot[0] / 1000.0 / n, tot[1] / 1000.0 / n, tot[2] / 1000.0 / n])
	for w in worst.slice(0, 8):
		print("  tick %d: step %.1f ms, snapshot %.1f, json %.1f, units %d" % [w[3], w[0], w[1], w[2], w[4]])
	quit()
