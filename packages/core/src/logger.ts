export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const consoleLogger: Logger = {
  debug: (m) => console.debug(`[quiesco] ${m}`),
  info: (m) => console.info(`[quiesco] ${m}`),
  warn: (m) => console.warn(`[quiesco] ${m}`),
  error: (m) => console.error(`[quiesco] ${m}`),
};

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
