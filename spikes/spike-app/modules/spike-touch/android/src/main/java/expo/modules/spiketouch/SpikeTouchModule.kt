package expo.modules.spiketouch

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Phase 0 spike: touch injection experiments (S3) live here.
class SpikeTouchModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SpikeTouch")

    Function("ping") {
      "android"
    }
  }
}
