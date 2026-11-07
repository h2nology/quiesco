import ExpoModulesCore

// Phase 0 spike: touch injection experiments (S4) live here.
public class SpikeTouchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SpikeTouch")

    Function("ping") { () -> String in
      return "ios"
    }
  }
}
