extends SceneTree
## Plays a whole offline match through OfflineHost exactly as the game does (create, pick a hero, start, commands,
## snapshots, a real victory, the replay, then "Play again"), as fast as the machine allows, and reports the cost
## per frame. Exit code 0 = everything worked.
##   godot --headless --path godot -s res://offline/tests/match.gd

const Host = preload("res://scripts/offline_host.gd")


func _init() -> void:
	var host = Host.create()
	if host == null:
		print("MATCH FAIL: no host")
		quit(1)
		return
	host.open("tester-123")
	var got := {}
	var snaps := 0
	var winner = null
	var frame_ms_max := 0.0
	var frame_ms_sum := 0.0
	var frames := 0
	host.send({"t": "create", "name": "Tester"})
	host.send({"t": "hero", "heroId": "kaelen"})
	host.send({"t": "start"})
	var my_unit := -1
	var t_start := Time.get_ticks_msec()
	var i := 0
	while not got.has("replay") and Time.get_ticks_msec() - t_start < 600000:
		if i == 40:
			host.send({"t": "cmd", "cmd": {"c": "train", "unit": "miner"}})
		if i == 60:
			host.send({"t": "cmd", "cmd": {"c": "stance", "stance": "attack"}})
		if i % 200 == 100 and my_unit > 0:
			host.send({"t": "cmd", "cmd": {"c": "cast", "slot": "Q", "x": 0.0, "z": 0.0}})
		var t0 := Time.get_ticks_usec()
		var msgs: Array = host.poll(0.25)  # the host runs on its own thread; poll only exchanges messages
		var ms := (Time.get_ticks_usec() - t0) / 1000.0
		frame_ms_max = maxf(frame_ms_max, ms)
		frame_ms_sum += ms
		frames += 1
		OS.delay_msec(1)
		i += 1
		for m in msgs:
			got[m.t] = got.get(m.t, 0) + 1
			if m.t == "init":
				for p in m.init.players:
					if p.playerId == "tester-123":
						my_unit = int(p.unitId)
			elif m.t == "snap":
				snaps += 1
				if m.s.has("winner"):
					winner = m.s.winner
	print("messages: ", got, " snapshots: ", snaps, " winner: ", winner)
	print("game-thread cost of poll(): %.3f ms average, %.3f ms worst; match took %.1f s of wall time" % [frame_ms_sum / maxi(1, frames), frame_ms_max, (Time.get_ticks_msec() - t_start) / 1000.0])
	var ok: bool = got.get("welcome", 0) == 1 and got.get("init", 0) >= 1 and snaps > 1000 and winner != null and got.has("replay") and my_unit > 0
	# Play again: back to the lobby and a second match
	host.send({"t": "lobbyReturn"})
	host.send({"t": "start"})
	var second := 0
	for k in 400:
		for m in host.poll(0.05):
			if m.t == "init":
				second += 1
		OS.delay_msec(2)
	ok = ok and second == 1
	host.stop()
	print("MATCH ", "OK" if ok else "FAIL")
	quit(0 if ok else 1)
