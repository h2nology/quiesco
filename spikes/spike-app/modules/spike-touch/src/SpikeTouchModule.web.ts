// Web has no native touch module: input is injected by Playwright on the host side.
const unsupported = () => Promise.reject(new Error('native touch injection is not available on web'));

export default {
  ping(): string {
    return 'web';
  },
  // Web reads params in JS (window.__QUIESCO__ / URL query), not from a native module.
  getLaunchParams(): { port?: string | null; session?: string | null } {
    return {};
  },
  tap: unsupported,
  touchDown: unsupported,
  touchUp: unsupported,
};
