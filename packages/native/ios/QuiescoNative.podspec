require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'QuiescoNative'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = 'Quiesco'
  s.homepage       = 'https://github.com/quiesco/quiesco'
  # 15.1: the oldest default deployment target of the supported Expo SDKs (55); autolinking skips a pod
  # whose platform is newer than the app's, silently (.planning/2026-11-16-expo-sdk-55-57).
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # IOHIDEvent* (private C API) lives in IOKit. This pod is only linked into e2e builds:
  # @quiesco/expo-plugin excludes it from autolinking otherwise (docs/spikes/06-prod-strip.md).
  s.frameworks = 'IOKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,swift}'
end
