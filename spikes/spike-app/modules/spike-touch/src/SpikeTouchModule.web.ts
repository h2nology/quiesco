// Web has no native touch module: input is injected by Playwright on the host side.
export default {
  ping(): string {
    return 'web';
  },
};
