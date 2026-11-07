// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const { withQuiesco } = require('@quiesco/agent/metro');

// withQuiesco: real agent when EXPO_PUBLIC_QUIESCO=1, a no-op stub otherwise (docs/spikes/06).
module.exports = withQuiesco(getDefaultConfig(__dirname));
