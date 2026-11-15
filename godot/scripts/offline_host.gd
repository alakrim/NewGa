class_name OfflineHost
extends RefCounted
## Runs the real Bannerfall lobby and match code on this device: res://offline/bf-offline.js is the TypeScript
## server logic and simulation bundled for a browser (`npm run build:offline`, src/offline/host.ts). Net.gd talks
## to it with the same JSON messages it sends a server. The client drives it once per frame, so the host never
## needs timers of its own:  __bf.frame(messages, ms) -> server messages.
##
## Backends:
## - Android: a WebView created through JavaClassWrapper (no Java code or plugin). Its JavaScript engine runs the
##   bundle. WebView calls must happen on Android's UI thread, and its callbacks arrive there too, so they only
##   touch the mutex-guarded fields below; everything else runs on Godot's main thread.
## - Desktop (tests): Node runs tools/offline-cli.cjs through a pipe, one JSON line per frame.

const BUNDLE := "res://offline/bf-offline.js"
const READY_TIMEOUT := 20.0

var ready := false
var failed := ""  # why the host could not start; empty while fine
var stage := "starting"  # shown on the menu while offline play starts: what the host is waiting for

var _queue: Array = []  # client messages since the last frame (main thread)
var _ms := 0.0  # real time since the last frame
var _pid := ""
var _opened := false
var _waited := 0.0
var _busy_for := 0.0  # how long the current evaluateJavascript call has been pending

# desktop backend
var _pipe: FileAccess

# Android backend
var _android := false
var _activity: JavaObject
var _webview_class: JavaClass
var _layout_class: JavaClass
var _ui_job: JavaObject  # Runnable that runs _on_ui_thread
var _value_cb: JavaObject  # ValueCallback that receives evaluateJavascript results
var _html := ""
var _mutex := Mutex.new()
var _webview: JavaObject  # created and used on the UI thread only
var _js := ""  # script for the UI thread to evaluate next (guarded by _mutex)
var _in_flight := false  # an evaluateJavascript call is pending (guarded by _mutex)
var _results: Array = []  # raw evaluateJavascript results (guarded by _mutex)
var _ui_error := ""  # guarded by _mutex


## An offline host for this platform, or null when there is none (Android without AndroidRuntime, desktop without
## Node, or a missing bundle); then `why[0]` says which.
static func create(why: Array = [""]) -> OfflineHost:
	if not FileAccess.file_exists(BUNDLE):
		why[0] = "the game files are missing " + BUNDLE
		return null
	var h := OfflineHost.new()
	var err := h._start_android() if OS.get_name() == "Android" else h._start_desktop()
	if err != "":
		why[0] = err
		return null
	return h


func open(pid: String) -> void:
	_pid = pid


func send(msg: Dictionary) -> void:
	_queue.append(msg)


## Advances the host by `delta` seconds and returns the server messages it produced (Dictionaries), in order.
func poll(delta: float) -> Array:
	_ms += delta * 1000.0
	if failed != "":
		return []
	return _poll_android(delta) if _android else _poll_desktop()


func stop() -> void:
	if _pipe:
		_pipe.close()
		_pipe = null
	ready = false


# ------------------------------------------------------------------ desktop: Node through a pipe
func _start_desktop() -> String:
	var cli := ProjectSettings.globalize_path("res://").path_join("../tools/offline-cli.cjs")
	if not FileAccess.file_exists(cli):
		return "tools/offline-cli.cjs not found"
	var p := OS.execute_with_pipe("/usr/bin/env", ["node", cli, ProjectSettings.globalize_path(BUNDLE)])
	if p.is_empty():
		return "could not start Node"
	_pipe = p.stdio
	return ""


func _request(req: Dictionary) -> Array:
	_pipe.store_line(JSON.stringify(req))
	_pipe.flush()
	var line := _pipe.get_line()
	var out = JSON.parse_string(line)
	if typeof(out) != TYPE_ARRAY:
		failed = "offline host stopped (%s)" % line.left(120)
		return []
	return out


func _poll_desktop() -> Array:
	if not _opened:
		_opened = true
		ready = true
		stage = "ready"
		return _request({"open": _pid})
	var out := _request({"msgs": _queue, "ms": _ms})
	_queue = []
	_ms = 0.0
	return out


# ------------------------------------------------------------------ Android: the system WebView via JavaClassWrapper
func _start_android() -> String:
	if not Engine.has_singleton("AndroidRuntime"):
		return "no AndroidRuntime"
	var rt = Engine.get_singleton("AndroidRuntime")
	_activity = rt.getActivity()
	if _activity == null:
		return "no activity"
	_webview_class = JavaClassWrapper.wrap("android.webkit.WebView")
	_layout_class = JavaClassWrapper.wrap("android.view.ViewGroup$LayoutParams")
	if _webview_class == null or _layout_class == null:
		return "no WebView class"
	_ui_job = JavaClassWrapper.create_sam_callback("java.lang.Runnable", _on_ui_thread)
	_value_cb = JavaClassWrapper.create_sam_callback("android.webkit.ValueCallback", _on_js_result)
	if _ui_job == null or _value_cb == null:
		return "could not create Java callbacks"
	var js := FileAccess.get_file_as_string(BUNDLE)
	if js.length() < 1000:
		return "could not read " + BUNDLE
	_html = "<!doctype html><html><head><meta charset=\"utf-8\"><script>" + js + "</script></head><body></body></html>"
	_android = true
	stage = "creating the engine view"
	_run_js("")  # creates the WebView and loads the bundle
	return ""


## Posts `js` to the UI thread (empty: only make sure the WebView exists). One call is in flight at a time.
func _run_js(js: String) -> void:
	_mutex.lock()
	_js = js
	_in_flight = true
	_mutex.unlock()
	_activity.runOnUiThread(_ui_job)


## Runs on Android's UI thread.
func _on_ui_thread() -> void:
	_mutex.lock()
	var js := _js
	_mutex.unlock()
	if _webview == null:
		_webview = _webview_class.WebView(_activity)
		if _webview == null or JavaClassWrapper.get_exception() != null:
			_fail_ui("could not create a WebView")
			return
		_webview.getSettings().setJavaScriptEnabled(true)
		# attached to the window (1 x 1 px, invisible) so Android treats the page as a live, visible one
		_webview.setAlpha(0.0)
		_activity.addContentView(_webview, _layout_class.LayoutParams(1, 1))
		JavaClassWrapper.get_exception()  # not fatal if attaching fails: the page also runs detached
		_webview.loadDataWithBaseURL("https://offline.bannerfall.invalid/", _html, "text/html", "utf-8", "about:blank")
		var ex = JavaClassWrapper.get_exception()
		if ex != null:
			_fail_ui("WebView: %s" % ex.toString())
			return
	if js == "":
		_mutex.lock()
		_in_flight = false
		_mutex.unlock()
		return
	_webview.evaluateJavascript(js, _value_cb)


## Runs on Android's UI thread.
func _fail_ui(why: String) -> void:
	_mutex.lock()
	_ui_error = why
	_in_flight = false
	_mutex.unlock()


## Runs on Android's UI thread with the JSON-encoded value of the evaluated script.
func _on_js_result(value) -> void:
	_mutex.lock()
	_results.append(str(value) if value != null else "null")
	_in_flight = false
	_mutex.unlock()


func _poll_android(delta: float) -> Array:
	_mutex.lock()
	var results := _results
	_results = []
	var busy := _in_flight
	var err := _ui_error
	_mutex.unlock()
	if err != "":
		failed = err
		return []
	var out: Array = []
	for r in results:
		var v = JSON.parse_string(r)
		if not ready:
			# readiness probe: the page has defined __bf (until then the probe answers false or null)
			if v is float and int(v) >= 1:
				ready = true
				stage = "ready"
			continue
		if v is Array:
			out.append_array(v)
	if busy:
		# a result that never comes (page reloaded under the call) must not stall the match: give up on it
		_busy_for += delta
		if _busy_for > 3.0:
			_mutex.lock()
			_in_flight = false
			_mutex.unlock()
			_busy_for = 0.0
		return out
	_busy_for = 0.0
	if not ready:
		_waited += delta
		stage = "loading the game engine %ds" % int(_waited)
		if _waited > READY_TIMEOUT:
			failed = "the game engine page did not load in %d s" % int(READY_TIMEOUT)
			return out
		_run_js("(typeof __bf === 'object' && __bf.version) || 0")
		return out
	if not _opened:
		_opened = true
		_run_js("__bf.open(%s)" % JSON.stringify(_pid if _pid != "" else null))
		return out
	_run_js("__bf.frame(%s, %f)" % [JSON.stringify(_queue), _ms])
	_queue = []
	_ms = 0.0
	return out
