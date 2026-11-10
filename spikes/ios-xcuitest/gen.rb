# Generates QuiescoSystemUI.xcodeproj: a stub host app + a UI test bundle (6.7 batch C spike).
require 'xcodeproj'
dir = __dir__
path = File.join(dir, 'QuiescoSystemUI.xcodeproj')
project = Xcodeproj::Project.new(path)
host = project.new_target(:application, 'Host', :ios, '17.0')
host.add_file_references([project.main_group.new_file(File.join(dir, 'Host/main.swift'))])
runner = project.new_target(:ui_test_bundle, 'Runner', :ios, '17.0')
runner.add_file_references([project.main_group.new_file(File.join(dir, 'Runner/SystemUIServer.swift'))])
runner.add_dependency(host)
[host, runner].each do |t|
  t.build_configurations.each do |c|
    s = c.build_settings
    s['SWIFT_VERSION'] = '5.0'
    s['CODE_SIGNING_ALLOWED'] = 'NO'
    s['CODE_SIGN_IDENTITY'] = ''
    s['GENERATE_INFOPLIST_FILE'] = 'YES'
    s['PRODUCT_BUNDLE_IDENTIFIER'] = t == host ? 'dev.quiesco.systemui.host' : 'dev.quiesco.systemui.runner'
  end
end
runner.build_configurations.each { |c| c.build_settings['TEST_TARGET_NAME'] = 'Host' }
project.save
scheme = Xcodeproj::XCScheme.new
scheme.configure_with_targets(host, runner)
scheme.save_as(path, 'Runner', true)
puts "wrote #{path}"
