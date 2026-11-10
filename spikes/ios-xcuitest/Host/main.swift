// Stub host app: an iOS UI test bundle needs a target application; the runner never launches it.
import UIKit

final class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
}

UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(AppDelegate.self))
