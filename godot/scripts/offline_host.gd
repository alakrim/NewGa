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
## Node, or a missing bundle).
static func create() -> OfflineHost:
	if not FileAccess.file_exists(BUNDLE):
		push_warning("offline: missing " + BUNDLE)
		return null
	var h := OfflineHost.new()
	if OS.get_name() == "Android":
		return h if h._start_android() else null
	return h if h._start_desktop() else null


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
func _start_desktop() -> bool:
	var cli := ProjectSettings.globalize_path("res://").path_join("../tools/offline-cli.cjs")
	if not FileAccess.file_exists(cli):
		return false
	var p := OS.execute_with_pipe("/usr/bin/env", ["node", cli, ProjectSettings.globalize_path(BUNDLE)])
	if p.is_empty():
		return false
	_pipe = p.stdio
	return true


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
		return _request({"open": _pid})
	var out := _request({"msgs": _queue, "ms": _ms})
	_queue = []
	_ms = 0.0
	return out


# ------------------------------------------------------------------ Android: the system WebView via JavaClassWrapper
func _start_android() -> bool:
	if not Engine.has_singleton("AndroidRuntime"):
		return false
	var rt = Engine.get_singleton("AndroidRuntime")
	_activity = rt.getActivity()
	_webview_class = JavaClassWrapper.wrap("android.webkit.WebView")
	if _activity == null or _webview_class == null:
		return false
	_ui_job = JavaClassWrapper.create_sam_callback("java.lang.Runnable", _on_ui_thread)
	_value_cb = JavaClassWrapper.create_sam_callback("android.webkit.ValueCallback", _on_js_result)
	if _ui_job == null or _value_cb == null:
		return false
	var js := FileAccess.get_file_as_string(BUNDLE)
	_html = "<!doctype html><html><head><meta charset=\"utf-8\"><script>" + js + "</script></head><body></body></html>"
	_android = true
	_run_js("")  # creates the WebView and loads the bundle
	return true


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
		_webview.getSettings().setJavaScriptEnabled(true)
		_webview.loadDataWithBaseURL("https://offline.bannerfall.invalid/", _html, "text/html", "utf-8", "about:blank")
		var ex = JavaClassWrapper.get_exception()
		if ex != null:
			_mutex.lock()
			_ui_error = "WebView: %s" % ex.toString()
			_in_flight = false
			_mutex.unlock()
			return
	if js == "":
		_mutex.lock()
		_in_flight = false
		_mutex.unlock()
		return
	_webview.evaluateJavascript(js, _value_cb)


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
		if _waited > READY_TIMEOUT:
			failed = "the offline host did not start"
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
