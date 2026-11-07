/**
 * Phase 0 / S6 spike: exclude the touch-injection native module from autolinking unless this is an
 * e2e build. Runs at `expo prebuild` time (CNG), so the env var must be set for prebuild + build.
 *
 *   e2e:  EXPO_PUBLIC_QUIESCO=1 npx expo prebuild   -> module linked
 *   prod: npx expo prebuild                          -> use_expo_modules!(exclude: [...]) / expoAutolinking.exclude
 */
const { withPodfile, withSettingsGradle } = require('expo/config-plugins');

const MARK = '# quiesco: exclude native module in non-e2e builds';

function withQuiescoNative(config, { moduleName = 'spike-touch' } = {}) {
  const isE2E = process.env.EXPO_PUBLIC_QUIESCO === '1';
  if (isE2E) return config;

  config = withPodfile(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes(MARK)) {
      src = src.replace(/^(\s*)use_expo_modules!\s*$/m, `$1${MARK}\n$1use_expo_modules!(exclude: ['${moduleName}'])`);
    }
    cfg.modResults.contents = src;
    return cfg;
  });

  config = withSettingsGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    const gMark = MARK.replace('#', '//');
    if (!src.includes(gMark)) {
      src = src.replace(/^expoAutolinking\.useExpoModules\(\)\s*$/m, `${gMark}\nexpoAutolinking.exclude = ["${moduleName}"]\nexpoAutolinking.useExpoModules()`);
    }
    cfg.modResults.contents = src;
    return cfg;
  });
  return config;
}

module.exports = withQuiescoNative;
