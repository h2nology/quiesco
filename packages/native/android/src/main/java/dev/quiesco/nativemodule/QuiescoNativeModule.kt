package dev.quiesco.nativemodule

import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
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

    // docs/spikes/05: `am start ... --es quiescoPort <p> --es quiescoSession <id>`
    Function("getLaunchParams") {
      val intent = appContext.currentActivity?.intent
      mapOf("port" to intent?.getStringExtra("quiescoPort"), "session" to intent?.getStringExtra("quiescoSession"))
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
        ?: return@AsyncFunction promise.reject("E_NO_WINDOW", "no window", null)
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
     * Type into the text field `tag` (or the EditText inside it) through its InputConnection, the path a
     * soft keyboard uses, so TextWatchers / onChangeText fire. `replace` clears the field first.
     */
    AsyncFunction("typeText") { tag: Int, text: String, replace: Boolean ->
      val view = findView(tag) ?: throw IllegalStateException("view $tag not found")
      val edit = findEditText(view) ?: throw IllegalStateException("view $tag is not a text field")
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
      mapOf("text" to (edit.text?.toString() ?: ""), "inputConnection" to (ic != null), "focused" to edit.isFocused)
    }.runOnQueue(Queues.MAIN)
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
    const val DOUBLE_TAP_GAP_MS = 80L
    const val STEP_MS = 16
  }
}
