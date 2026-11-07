// S6 spike: approach B — swap the agent module for a stub unless this is an e2e build.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const isE2E = process.env.EXPO_PUBLIC_QUIESCO === '1';
const stub = path.resolve(__dirname, 'spike/s6/agent-b.stub.ts');
const upstream = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (!isE2E && /spike\/s6\/agent-b$/.test(moduleName)) {
    return { type: 'sourceFile', filePath: stub };
  }
  return upstream ? upstream(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
