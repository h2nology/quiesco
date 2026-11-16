// @ts-check
/**
 * Expo SDK 55–57 on Xcode 27 (scripts/sdk-compat.mjs; not part of the example app): some pods / resource
 * bundles still declare iOS 9–13.4, which Xcode 27 rejects; expo-router 55 also uses an iOS 16 API without
 * an availability check. Props: `podsMin`, the iOS every pod below it is raised to; `appTarget`, the app's
 * deployment target when it must change (SDK 55: 15.1 → 16.0).
 */
const { withDangerousMod, withPodfileProperties, withXcodeProject } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

const MARK = '# sdk-compat: pods below';

/** @param {any} config @param {{ podsMin: string, appTarget?: string }} props */
module.exports = function sdkCompatIos(config, { podsMin, appTarget }) {
  if (appTarget !== undefined) {
    config = withPodfileProperties(config, (c) => {
      c.modResults['ios.deploymentTarget'] = appTarget;
      return c;
    });
    config = withXcodeProject(config, (c) => {
      const configs = c.modResults.pbxXCBuildConfigurationSection();
      for (const bc of Object.values(configs)) {
        if (typeof bc === 'object' && bc.buildSettings?.IPHONEOS_DEPLOYMENT_TARGET !== undefined) bc.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = appTarget;
      }
      return c;
    });
  }
  return withDangerousMod(config, [
    'ios',
    (c) => {
      const file = path.join(c.modRequest.platformProjectRoot, 'Podfile');
      let podfile = fs.readFileSync(file, 'utf8');
      if (!podfile.includes(MARK)) {
        podfile = podfile.replace(
          /post_install do \|installer\|\n/,
          (m) =>
            `${m}    ${MARK} iOS ${podsMin}\n    installer.pods_project.targets.each do |t|\n      t.build_configurations.each do |bc|\n        bc.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${podsMin}' if bc.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f < ${podsMin}\n      end\n    end\n`,
        );
        fs.writeFileSync(file, podfile);
      }
      return c;
    },
  ]);
};
