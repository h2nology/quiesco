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
  s.platforms      = { :ios => '16.4' }
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
