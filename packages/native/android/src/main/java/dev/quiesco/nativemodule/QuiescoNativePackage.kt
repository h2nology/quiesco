package dev.quiesco.nativemodule

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

/**
 * Keeps the connection parameters (`--es quiescoPort` / `--es quiescoSession`) for the life of the
 * process. An Expo dev client that has run before relaunches its activity with CLEAR_TASK and an
 * intent of its own, so by the time JS asks, `currentActivity.intent` no longer carries our extras;
 * the agent would then fall back to the build-time port (7357) — wrong for parallel worker N > 0.
 */
object LaunchParamsStore {
  @Volatile var port: String? = null
    private set
  @Volatile var session: String? = null
    private set
  /** Base64 of the test's launch arguments as JSON (`--es quiescoArgs`, Phase 6.5). */
  @Volatile var args: String? = null
    private set

  /** Remember the parameters of `intent` when it has them (a newer launch replaces older ones). */
  fun capture(intent: Intent?) {
    val p = intent?.getStringExtra("quiescoPort") ?: return
    port = p
    session = intent.getStringExtra("quiescoSession")
    args = intent.getStringExtra("quiescoArgs")
  }
}

class QuiescoNativePackage : Package {
  override fun createReactActivityLifecycleListeners(activityContext: Context?): List<ReactActivityLifecycleListener> =
    listOf(object : ReactActivityLifecycleListener {
      override fun onCreate(activity: Activity?, savedInstanceState: Bundle?) {
        LaunchParamsStore.capture(activity?.intent)
      }

      override fun onNewIntent(intent: Intent?): Boolean {
        LaunchParamsStore.capture(intent)
        return false // observe only; other listeners still handle the intent
      }
    })
}
