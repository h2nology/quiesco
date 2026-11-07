package expo.modules.spiketouch

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Phase 0 / S3 spike: inject real touches inside the app process.
 * MotionEvent -> Activity.dispatchTouchEvent (public API only). Coordinates come in as dp
 * (from getBoundingClientRect in JS) and are converted to px here.
 */
class SpikeTouchModule : Module() {
  private val main = Handler(Looper.getMainLooper())

  // state for split touchDown/touchUp
  private var downTime = 0L
  private var lastX = 0f
  private var lastY = 0f

  override fun definition() = ModuleDefinition {
    Name("SpikeTouch")

    Function("ping") {
      "android"
    }

    AsyncFunction("tap") { xDp: Double, yDp: Double, holdMs: Int, promise: Promise ->
      val (x, y) = toPx(xDp, yDp)
      val down = SystemClock.uptimeMillis()
      val okDown = dispatch(down, down, MotionEvent.ACTION_DOWN, x, y)
      main.postDelayed({
        val okUp = dispatch(down, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, x, y)
        promise.resolve(mapOf("x" to x, "y" to y, "down" to okDown, "up" to okUp))
      }, holdMs.toLong())
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("touchDown") { xDp: Double, yDp: Double ->
      val (x, y) = toPx(xDp, yDp)
      downTime = SystemClock.uptimeMillis()
      lastX = x
      lastY = y
      mapOf("x" to x, "y" to y, "handled" to dispatch(downTime, downTime, MotionEvent.ACTION_DOWN, x, y))
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("touchUp") {
      mapOf("handled" to dispatch(downTime, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, lastX, lastY))
    }.runOnQueue(Queues.MAIN)
  }

  private fun toPx(xDp: Double, yDp: Double): Pair<Float, Float> {
    val density = appContext.reactContext?.resources?.displayMetrics?.density ?: 1f
    return Pair((xDp * density).toFloat(), (yDp * density).toFloat())
  }

  private fun dispatch(downTime: Long, eventTime: Long, action: Int, x: Float, y: Float): Boolean {
    val activity = appContext.currentActivity ?: throw IllegalStateException("no current activity")
    val props = arrayOf(MotionEvent.PointerProperties().apply {
      id = 0
      toolType = MotionEvent.TOOL_TYPE_FINGER
    })
    val coords = arrayOf(MotionEvent.PointerCoords().apply {
      this.x = x
      this.y = y
      pressure = 1f
      size = 1f
    })
    val ev = MotionEvent.obtain(
      downTime, eventTime, action, 1, props, coords,
      0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0,
    )
    try {
      return activity.dispatchTouchEvent(ev)
    } finally {
      ev.recycle()
    }
  }
}
