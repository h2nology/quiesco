package dev.quiesco.nativemodule

import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import android.view.inputmethod.EditorInfo
import android.widget.AbsSeekBar
import android.widget.EditText
import com.facebook.react.uimanager.UIManagerHelper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Real touch / text input inside the app process (requirements.md §6.3, docs/spikes/03-android-touch.md).
 * Public Android APIs only. Targets are addressed by React view tag: the View's real on-screen position
 * is read here (so native-driver animations are taken into account) and events are dispatched to the
 * root view of the window the View lives in (so RN `Modal` dialogs work).
 * Coordinates exchanged with JS are dp in that window's coordinate space.
 */
class QuiescoNativeModule : Module() {
  private val main = Handler(Looper.getMainLooper())

  override fun definition() = ModuleDefinition {
    Name("QuiescoNative")

    // docs/spikes/05: `am start ... --es quiescoPort <p> --es quiescoSession <id>`. The current intent may
    // have lost the extras (dev client relaunch), so fall back to what QuiescoNativePackage captured.
    Function("getLaunchParams") {
      LaunchParamsStore.capture(appContext.currentActivity?.intent)
      mapOf("port" to LaunchParamsStore.port, "session" to LaunchParamsStore.session, "args" to LaunchParamsStore.args)
    }

    /** Where a view really is, and whether its window is the one receiving input. */
    AsyncFunction("locate") { tag: Int ->
      val view = findView(tag) ?: return@AsyncFunction mapOf("found" to false)
      describe(view)
    }.runOnQueue(Queues.MAIN)

    /** Tap the center of `tag` (or the point `x`,`y` in dp of the activity window when tag < 0). */
    AsyncFunction("tap") { tag: Int, xDp: Double, yDp: Double, holdMs: Int, count: Int, promise: Promise ->
      val target = resolveTarget(tag, xDp, yDp) ?: return@AsyncFunction promise.reject("E_NO_VIEW", "view $tag not found", null)
      val (root, x, y) = target
      var handled = true
      fun one(i: Int) {
        val down = SystemClock.uptimeMillis()
        handled = dispatch(root, down, down, MotionEvent.ACTION_DOWN, x, y) && handled
        main.postDelayed({
          handled = dispatch(root, down, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, x, y) && handled
          if (i + 1 < count) main.postDelayed({ one(i + 1) }, DOUBLE_TAP_GAP_MS) else promise.resolve(result(root, x, y, handled))
        }, holdMs.toLong())
      }
      one(0)
    }.runOnQueue(Queues.MAIN)

    /** Drag from (fromX, fromY) to (toX, toY) in dp of the window of `tag` over `durationMs`. */
    AsyncFunction("swipe") { tag: Int, fromX: Double, fromY: Double, toX: Double, toY: Double, durationMs: Int, promise: Promise ->
      val root = (if (tag >= 0) findView(tag)?.rootView else null) ?: appContext.currentActivity?.window?.decorView
        ?: return@AsyncFunction promise.reject("E_NO_VIEW", "no window for view $tag", null)
      val d = density()
      val steps = maxOf(4, durationMs / STEP_MS)
      val down = SystemClock.uptimeMillis()
      val x0 = (fromX * d).toFloat(); val y0 = (fromY * d).toFloat()
      val x1 = (toX * d).toFloat(); val y1 = (toY * d).toFloat()
      var handled = dispatch(root, down, down, MotionEvent.ACTION_DOWN, x0, y0)
      fun step(i: Int) {
        val t = i.toFloat() / steps
        val x = x0 + (x1 - x0) * t; val y = y0 + (y1 - y0) * t
        if (i < steps) {
          handled = dispatch(root, down, SystemClock.uptimeMillis(), MotionEvent.ACTION_MOVE, x, y) && handled
          main.postDelayed({ step(i + 1) }, (durationMs / steps).toLong())
        } else {
          handled = dispatch(root, down, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, x1, y1) && handled
          promise.resolve(mapOf("handled" to handled))
        }
      }
      main.postDelayed({ step(1) }, (durationMs / steps).toLong())
    }.runOnQueue(Queues.MAIN)

    /**
     * One finger along a timed path in dp of the window of `tag` (activity window when tag < 0): `path`
     * is flat [x, y, tMs, ...] with t from 0, increasing. Down at the first point, up at the last; moves
     * are interpolated every STEP_MS between points that differ, none while the finger rests (a hold).
     */
    AsyncFunction("gesture") { tag: Int, path: List<Double>, promise: Promise ->
      if (path.size < 6 || path.size % 3 != 0) return@AsyncFunction promise.reject("E_BAD_ARGS", "path needs at least two [x, y, tMs] points", null)
      val root = (if (tag >= 0) findView(tag)?.rootView else null) ?: appContext.currentActivity?.window?.decorView
        ?: return@AsyncFunction promise.reject("E_NO_VIEW", "no window for view $tag", null)
      val d = density()
      val pts = (path.indices step 3).map { Triple((path[it] * d).toFloat(), (path[it + 1] * d).toFloat(), path[it + 2]) }
      val events = ArrayList<Triple<Float, Float, Double>>()
      for (i in 1 until pts.size) {
        val (ax, ay, ta) = pts[i - 1]
        val (bx, by, tb) = pts[i]
        val steps = if (ax == bx && ay == by) 1 else maxOf(1, ((tb - ta) / STEP_MS).toInt())
        for (k in 1..steps) {
          val t = k.toFloat() / steps
          events.add(Triple(ax + (bx - ax) * t, ay + (by - ay) * t, ta + (tb - ta) * t))
        }
      }
      val down = SystemClock.uptimeMillis()
      var handled = dispatch(root, down, down, MotionEvent.ACTION_DOWN, pts[0].first, pts[0].second)
      fun fire(i: Int) {
        val (x, y, _) = events[i]
        val last = i == events.size - 1
        handled = dispatch(root, down, SystemClock.uptimeMillis(), if (last) MotionEvent.ACTION_UP else MotionEvent.ACTION_MOVE, x, y) && handled
        if (last) promise.resolve(mapOf("handled" to handled))
        else main.postAtTime({ fire(i + 1) }, down + events[i + 1].third.toLong())
      }
      main.postAtTime({ fire(0) }, down + events[0].third.toLong())
    }.runOnQueue(Queues.MAIN)

    /**
     * Several fingers along timed paths in dp of the window of `tag` (activity window when tag < 0).
     * `frames` is flat: per frame [tMs, down0, x0, y0, down1, x1, y1, ...] for `fingerCount` fingers
     * (down = 1 while the finger touches), t from 0 and increasing. Per frame, as a touchscreen reports
     * it: new fingers go down (ACTION_DOWN, then ACTION_POINTER_DOWN), moved fingers move (one
     * ACTION_MOVE with every pointer), lifted fingers go up (ACTION_POINTER_UP, the last ACTION_UP).
     * Every finger is lifted after the last frame.
     */
    AsyncFunction("multiGesture") { tag: Int, fingerCount: Int, frames: List<Double>, promise: Promise ->
      val stride = 1 + 3 * fingerCount
      if (fingerCount < 1 || frames.size < stride || frames.size % stride != 0) {
        return@AsyncFunction promise.reject("E_BAD_ARGS", "frames must be [t, down, x, y, ...] for $fingerCount fingers", null)
      }
      val root = (if (tag >= 0) findView(tag)?.rootView else null) ?: appContext.currentActivity?.window?.decorView
        ?: return@AsyncFunction promise.reject("E_NO_VIEW", "no window for view $tag", null)
      val d = density()
      val count = frames.size / stride
      val down = SystemClock.uptimeMillis()
      val touch = MultiTouch(root, down)
      fun fire(f: Int) {
        val base = f * stride
        val points = (0 until fingerCount).map { i ->
          val o = base + 1 + 3 * i
          if (frames[o] > 0.5) Pair((frames[o + 1] * d).toFloat(), (frames[o + 2] * d).toFloat()) else null
        }
        touch.frame(points)
        if (f + 1 < count) {
          main.postAtTime({ fire(f + 1) }, down + frames[(f + 1) * stride].toLong())
        } else {
          touch.frame(points.map { null })
          promise.resolve(mapOf("handled" to touch.handled))
        }
      }
      main.postAtTime({ fire(0) }, down + frames[0].toLong())
    }.runOnQueue(Queues.MAIN)

    /**
     * A key of the soft keyboard on the text field `tag`, through its InputConnection: `enter` performs
     * the field's IME action (where React Native submits), or commits a newline when the field asks for
     * no enter action (multi-line); `backspace` sends KEYCODE_DEL (RN reports it to onKeyPress).
     */
    AsyncFunction("pressKey") { tag: Int, key: String, promise: Promise ->
      val view = findView(tag) ?: return@AsyncFunction promise.reject("E_NO_VIEW", "view $tag not found", null)
      val edit = findEditText(view) ?: return@AsyncFunction promise.reject("E_NOT_TEXT_INPUT", "view $tag is not a text field", null)
      edit.requestFocus()
      val info = EditorInfo()
      val ic = edit.onCreateInputConnection(info) ?: return@AsyncFunction promise.reject("E_NOT_TEXT_INPUT", "view $tag has no input connection", null)
      when (key) {
        "enter" -> {
          val action = info.imeOptions and EditorInfo.IME_MASK_ACTION
          if ((info.imeOptions and EditorInfo.IME_FLAG_NO_ENTER_ACTION) != 0 || action == EditorInfo.IME_ACTION_NONE) ic.commitText("\n", 1)
          else ic.performEditorAction(if (action == EditorInfo.IME_ACTION_UNSPECIFIED) EditorInfo.IME_ACTION_DONE else action)
        }
        "backspace" -> {
          ic.sendKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DEL))
          ic.sendKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_DEL))
        }
        else -> return@AsyncFunction promise.reject("E_BAD_ARGS", "unknown key $key", null)
      }
      promise.resolve(mapOf("text" to (edit.text?.toString() ?: ""), "focused" to edit.isFocused))
    }.runOnQueue(Queues.MAIN)

    /**
     * Type into the text field `tag` (or the EditText inside it) through its InputConnection, the path a
     * soft keyboard uses, so TextWatchers / onChangeText fire. `replace` clears the field first.
     */
    AsyncFunction("typeText") { tag: Int, text: String, replace: Boolean, promise: Promise ->
      val view = findView(tag) ?: return@AsyncFunction promise.reject("E_NO_VIEW", "view $tag not found", null)
      val edit = findEditText(view) ?: return@AsyncFunction promise.reject("E_NOT_TEXT_INPUT", "view $tag is not a text field", null)
      edit.requestFocus()
      val ic = edit.onCreateInputConnection(EditorInfo())
      if (ic != null) {
        ic.beginBatchEdit()
        if (replace) {
          ic.setSelection(0, edit.text?.length ?: 0)
          ic.commitText("", 1)
        }
        ic.commitText(text, 1)
        ic.endBatchEdit()
      } else {
        if (replace) edit.setText(text) else edit.text?.append(text)
      }
      promise.resolve(mapOf("text" to (edit.text?.toString() ?: ""), "inputConnection" to (ic != null), "focused" to edit.isFocused))
    }.runOnQueue(Queues.MAIN)

    /**
     * Geometry of the SeekBar in `tag`'s view, in dp of its window: x of the thumb center at the minimum
     * and at the maximum (the track spans the view minus its horizontal padding), the current thumb x and y.
     */
    AsyncFunction("sliderInfo") { tag: Int ->
      val view = findView(tag) ?: return@AsyncFunction mapOf("found" to false)
      val bar = findSeekBar(view) ?: return@AsyncFunction mapOf("found" to false)
      val d = density()
      val loc = IntArray(2)
      bar.getLocationInWindow(loc)
      val lo = loc[0] + bar.paddingLeft
      val hi = loc[0] + bar.width - bar.paddingRight
      val min = if (Build.VERSION.SDK_INT >= 26) bar.min else 0
      val ratio = if (bar.max > min) (bar.progress - min).toFloat() / (bar.max - min) else 0f
      mapOf(
        "found" to true, "minX" to lo / d, "maxX" to hi / d, "y" to (loc[1] + bar.height / 2f) / d,
        "thumbX" to (lo + (hi - lo) * ratio) / d, "value" to bar.progress, "minimum" to min, "maximum" to bar.max,
      )
    }.runOnQueue(Queues.MAIN)

    /**
     * Perform the accessibility action `name` on `tag`'s view the way TalkBack does
     * (View.performAccessibilityAction). React Native's ReactAccessibilityDelegate maps the standard
     * names to framework actions and gives every other declared action a generated id (from 0x3f000000)
     * in declaration order: `customIndex` is the action's index among those.
     */
    AsyncFunction("accessibilityAction") { tag: Int, name: String, _label: String, _index: Int, customIndex: Int, promise: Promise ->
      val view = findView(tag) ?: return@AsyncFunction promise.reject("E_NO_VIEW", "view $tag not found", null)
      // Like TalkBack, read the node info first: ReactAccessibilityDelegate fills its id → name map there,
      // and only performs actions it has listed.
      val info = view.createAccessibilityNodeInfo()
      val id = STANDARD_ACTIONS[name] ?: info.actionList.filter { it.id >= CUSTOM_ACTION_BASE }.getOrNull(customIndex)?.id
        ?: return@AsyncFunction promise.reject("E_NO_ACTION", "view $tag has no accessibility action \"$name\"", null)
      if (info.actionList.none { it.id == id }) {
        return@AsyncFunction promise.reject("E_NO_ACTION", "view $tag does not offer the accessibility action \"$name\" (offers ${info.actionList.map { it.id }})", null)
      }
      val performed = view.performAccessibilityAction(id, null)
      promise.resolve(mapOf("performed" to performed, "via" to "performAccessibilityAction", "actionId" to id))
    }.runOnQueue(Queues.MAIN)
  }

  /** Multi-pointer MotionEvents for one gesture, in px of `root`'s window. Pointer id = finger index. */
  private class MultiTouch(private val root: View, private val downTime: Long) {
    /** Fingers currently down, in pointer-index order (ascending id), with their positions. */
    private val active = sortedMapOf<Int, Pair<Float, Float>>()
    var handled = true

    fun frame(points: List<Pair<Float, Float>?>) {
      // 1. New fingers go down, each with the others at their previous positions.
      for ((i, p) in points.withIndex()) {
        if (p == null || active.containsKey(i)) continue
        active[i] = p
        val index = active.keys.indexOf(i)
        val action = if (active.size == 1) MotionEvent.ACTION_DOWN else MotionEvent.ACTION_POINTER_DOWN or (index shl MotionEvent.ACTION_POINTER_INDEX_SHIFT)
        send(action)
      }
      // 2. Fingers that stay down and moved: one move with every pointer.
      var moved = false
      for ((i, p) in points.withIndex()) {
        val cur = active[i] ?: continue
        if (p != null && p != cur) {
          active[i] = p
          moved = true
        }
      }
      if (moved) send(MotionEvent.ACTION_MOVE)
      // 3. Lifted fingers go up; the last one ends the gesture.
      for ((i, p) in points.withIndex()) {
        if (p != null || !active.containsKey(i)) continue
        val index = active.keys.indexOf(i)
        val action = if (active.size == 1) MotionEvent.ACTION_UP else MotionEvent.ACTION_POINTER_UP or (index shl MotionEvent.ACTION_POINTER_INDEX_SHIFT)
        send(action)
        active.remove(i)
      }
    }

    private fun send(action: Int) {
      val ids = active.keys.toList()
      val props = Array(ids.size) { k -> MotionEvent.PointerProperties().apply { id = ids[k]; toolType = MotionEvent.TOOL_TYPE_FINGER } }
      val coords = Array(ids.size) { k ->
        val (x, y) = active.getValue(ids[k])
        MotionEvent.PointerCoords().apply { this.x = x; this.y = y; pressure = 1f; size = 1f }
      }
      val ev = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), action, ids.size, props, coords, 0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0)
      try {
        handled = root.dispatchTouchEvent(ev) && handled
      } finally {
        ev.recycle()
      }
    }
  }

  private fun findSeekBar(view: View): AbsSeekBar? {
    if (view is AbsSeekBar) return view
    if (view is ViewGroup) for (i in 0 until view.childCount) findSeekBar(view.getChildAt(i))?.let { return it }
    return null
  }

  private fun density(): Float = appContext.reactContext?.resources?.displayMetrics?.density ?: 1f

  private fun findView(tag: Int): View? {
    val ctx = appContext.reactContext ?: return null
    return try {
      UIManagerHelper.getUIManagerForReactTag(ctx as com.facebook.react.bridge.ReactContext, tag)?.resolveView(tag)
    } catch (e: Exception) {
      null
    }
  }

  private fun findEditText(view: View): EditText? {
    if (view is EditText) return view
    if (view is ViewGroup) for (i in 0 until view.childCount) findEditText(view.getChildAt(i))?.let { return it }
    return null
  }

  /** Root view of the window and the target point in that window's px coordinates. */
  private fun resolveTarget(tag: Int, xDp: Double, yDp: Double): Triple<View, Float, Float>? {
    if (tag < 0) {
      val root = appContext.currentActivity?.window?.decorView ?: return null
      val d = density()
      return Triple(root, (xDp * d).toFloat(), (yDp * d).toFloat())
    }
    val view = findView(tag) ?: return null
    val loc = IntArray(2)
    view.getLocationInWindow(loc)
    return Triple(view.rootView, loc[0] + view.width / 2f, loc[1] + view.height / 2f)
  }

  private fun describe(view: View): Map<String, Any?> {
    val d = density()
    val loc = IntArray(2)
    view.getLocationInWindow(loc)
    val root = view.rootView
    val windows = if (Build.VERSION.SDK_INT >= 29) android.view.inspector.WindowInspector.getGlobalWindowViews() else emptyList()
    val visibleWindows = windows.filter { it.isAttachedToWindow && it.visibility == View.VISIBLE }
    return mapOf(
      "found" to true,
      "x" to loc[0] / d, "y" to loc[1] / d, "width" to view.width / d, "height" to view.height / d,
      "shown" to view.isShown,
      "windowHasFocus" to root.hasWindowFocus(),
      "windowIndex" to visibleWindows.indexOf(root),
      "windowCount" to visibleWindows.size,
      "windowClass" to root.javaClass.simpleName,
    )
  }

  private fun result(root: View, x: Float, y: Float, handled: Boolean): Map<String, Any?> {
    val d = density()
    return mapOf("x" to x / d, "y" to y / d, "handled" to handled, "windowHasFocus" to root.hasWindowFocus())
  }

  private fun dispatch(root: View, downTime: Long, eventTime: Long, action: Int, x: Float, y: Float): Boolean {
    val props = arrayOf(MotionEvent.PointerProperties().apply { id = 0; toolType = MotionEvent.TOOL_TYPE_FINGER })
    val coords = arrayOf(MotionEvent.PointerCoords().apply { this.x = x; this.y = y; pressure = 1f; size = 1f })
    val ev = MotionEvent.obtain(downTime, eventTime, action, 1, props, coords, 0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0)
    try {
      return root.dispatchTouchEvent(ev)
    } finally {
      ev.recycle()
    }
  }

  companion object {
    /** ReactAccessibilityDelegate: standard action names → framework action ids. */
    val STANDARD_ACTIONS = mapOf(
      "activate" to AccessibilityNodeInfo.ACTION_CLICK,
      "longpress" to AccessibilityNodeInfo.ACTION_LONG_CLICK,
      "increment" to AccessibilityNodeInfo.ACTION_SCROLL_FORWARD,
      "decrement" to AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD,
      "expand" to AccessibilityNodeInfo.ACTION_EXPAND,
      "collapse" to AccessibilityNodeInfo.ACTION_COLLAPSE,
    )
    const val CUSTOM_ACTION_BASE = 0x3f000000
    const val DOUBLE_TAP_GAP_MS = 80L
    const val STEP_MS = 16
  }
}
