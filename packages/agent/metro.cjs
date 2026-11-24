// @ts-check
/**
 * Metro integration (docs/spikes/06-prod-strip.md, approach B).
 *
 *   // metro.config.js
 *   const { getDefaultConfig } = require('expo/metro-config');
 *   const { withQuiesco } = require('@quiesco/agent/metro');
 *   module.exports = withQuiesco(getDefaultConfig(__dirname));
 *
 * - Not an e2e build (`EXPO_PUBLIC_QUIESCO !== '1'`): `@quiesco/agent` resolves to the stub, so no agent
 *   code reaches the bundle. A guard inside node_modules would not work: babel-preset-expo does not
 *   inline EXPO_PUBLIC_* there.
 * - e2e build: the agent's `build-config` module is replaced by a generated file carrying the fallback
 *   port / session (`EXPO_PUBLIC_QUIESCO_PORT`, `EXPO_PUBLIC_QUIESCO_SESSION`), used when no launch
 *   parameters are available (JS-only mode), and the bundle identity: when Metro loaded this config and
 *   whether it watches files (issue #3). One file per mode (`build-config.dev.js` for the dev server,
 *   `build-config.export.js` for a one-off bundle, issue #73): an `expo export` run while the dev server
 *   is up must not change the file the dev server watches.
 * - e2e build with `nativeModules: true` (or `EXPO_PUBLIC_QUIESCO_NATIVE_MODULES=1`): the generated
 *   build-config tells the agent to wrap native modules for the `native-module` tracker (issue #74).
 *   Without it the agent leaves `TurboModuleRegistry` and Expo's modules alone: the wrappers are JS
 *   functions, and libraries that call a module's methods from worklets on the UI runtime (Gesture
 *   Handler 3, Reanimated) need the native host functions.
 * - e2e build: the agent's early module (`src/early.ts`: React DevTools hook + scheduler patch) is put
 *   first in `serializer.getModulesRunBeforeMainModule`. React Native 0.88 loads its renderer from
 *   `setup-env`, which Metro runs before the app entry; a hook installed later is never seen by the
 *   renderer in release builds (no React DevTools hook there).
 *
 * - e2e build: `expo/fetch` imported by the app or a library resolves to `src/expo-fetch.js`, which
 *   re-exports it with a tracked `fetch` (Phase 6.10: the real module's exports are non-configurable
 *   getters, so the network tracker cannot patch them at runtime). Expo's own code reaches its fetch
 *   through relative paths and is not affected; the global fetch is tracked separately.
 *
 * - Always: the artifacts directory (`options.artifactsDir`, default `artifacts`, relative to the project
 *   root; `false` for none) is added to `resolver.blockList` (Phase 6.12).
 *   Metro sends every connected app an HMR update for any watched file that changes, even one outside
 *   the bundle; the dev client then shows its "Refreshing..." window over the app, and a touch from
 *   another parallel worker lands on that window. Screenshots and JSON written there would do that.
 *   `.expo/devices.json` is blocked for the same reason: Expo's dev server rewrites it on every manifest
 *   request, i.e. every time a dev client app starts (`ManifestMiddleware.saveDevicesAsync`).
 *
 * Plain CommonJS on purpose: Node loads metro.config.js without a TypeScript step.
 */
const fs = require('node:fs');
const path = require('node:path');

const AGENT = '@quiesco/agent';
const AGENT_SRC = path.join(__dirname, 'src');
const STUB = path.join(AGENT_SRC, 'stub.ts');
const EARLY = path.join(AGENT_SRC, 'early.ts');
const EXPO_FETCH = path.join(AGENT_SRC, 'expo-fetch.js');

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {boolean}
 */
function isE2E(env) {
  return env.EXPO_PUBLIC_QUIESCO === '1';
}

/**
 * A one-off bundle (`expo export`, `export:embed` in a release build, `react-native bundle`), not the dev
 * server.
 * @param {readonly string[]} argv
 */
function isOneOffBundle(argv) {
  return argv.some((a) => a === 'export' || a === 'export:embed' || a === 'bundle');
}

/**
 * Whether the bundle follows source changes (issue #3): not for a one-off bundle, and not when Metro runs
 * with `CI` set (Expo then starts it without a file watcher). `reason` says why not.
 * @param {NodeJS.ProcessEnv} env
 * @param {readonly string[]} argv
 * @returns {{ watching: boolean; reason?: string }}
 */
function watchMode(env, argv) {
  if (isOneOffBundle(argv)) return { watching: false, reason: 'export' };
  const ci = env.CI;
  if (ci !== undefined && ci !== '' && ci !== '0' && ci.toLowerCase() !== 'false') return { watching: false, reason: 'CI' };
  return { watching: true };
}

/**
 * Write the build-time connection fallback, the bundle identity (when Metro loaded its config: the dev
 * server's start or the export) and whether to wrap native modules, and return its path. The dev server
 * and a one-off bundle write different files (issue #73).
 * @param {string} projectRoot
 * @param {NodeJS.ProcessEnv} env
 * @param {readonly string[]} [argv]
 * @param {number} [now]
 * @param {{ nativeModules?: boolean }} [opts]
 */
function writeBuildConfig(projectRoot, env, argv = process.argv.slice(2), now = Date.now(), opts = {}) {
  const port = Number.parseInt(env.EXPO_PUBLIC_QUIESCO_PORT ?? '', 10);
  const config = {
    port: Number.isInteger(port) ? port : null,
    session: env.EXPO_PUBLIC_QUIESCO_SESSION ?? null,
    bundle: { builtAt: now, ...watchMode(env, argv) },
    ...(opts.nativeModules === true ? { nativeModules: true } : {}),
  };
  const dir = path.join(projectRoot, '.expo', 'quiesco');
  const file = path.join(dir, isOneOffBundle(argv) ? 'build-config.export.js' : 'build-config.dev.js');
  const source = `// Generated by @quiesco/agent/metro. Do not edit.\nexport const buildConfig = ${JSON.stringify(config)};\n`;
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== source) fs.writeFileSync(file, source);
  return file;
}

/** @param {string} p absolute path */
const escapePath = (p) => path.resolve(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `blockList` (a RegExp, a list of them, or unset) plus the given files and directories (with everything
 * under them).
 * @param {RegExp | RegExp[] | undefined | null} blockList
 * @param {{ files: string[]; dirs: string[] }} paths absolute paths
 * @returns {RegExp[]}
 */
function blockPaths(blockList, { files, dirs }) {
  const existing = blockList === undefined || blockList === null ? [] : Array.isArray(blockList) ? blockList : [blockList];
  return [
    ...existing,
    ...files.map((f) => new RegExp(`^${escapePath(f)}$`)),
    ...dirs.map((d) => new RegExp(`^${escapePath(d)}(?:[\\\\/].*)?$`)),
  ];
}

/** The agent's own sources, also through a symlinked node_modules (pnpm). */
const AGENT_SRC_REAL = (() => {
  try {
    return fs.realpathSync(AGENT_SRC);
  } catch {
    return AGENT_SRC;
  }
})();

/**
 * A stack frame in the agent's code. The agent wraps `console.*` (to forward the app's logs), so it is the
 * top frame of every `console.error` LogBox shows (issue #31): LogBox should point at the app's line.
 * @param {string | undefined} file
 */
function isAgentFrame(file) {
  if (typeof file !== 'string' || file === '') return false;
  return file.startsWith(AGENT_SRC + path.sep) || file.startsWith(AGENT_SRC_REAL + path.sep) || /[\\/]node_modules[\\/]@quiesco[\\/]agent[\\/]/.test(file);
}

/**
 * Collapse the agent's frames in symbolicated stacks (LogBox's call stack and source), on top of the
 * config's own customizeFrame (Expo's collapses React Native internals).
 * @param {((frame: { file?: string }) => unknown) | undefined | null} upstream
 */
function collapseAgentFrames(upstream) {
  /** @param {{ file?: string; lineNumber?: number; column?: number; methodName?: string }} frame */
  return function customizeFrame(frame) {
    const own = typeof upstream === 'function' ? upstream(frame) : undefined;
    if (!isAgentFrame(frame.file)) return own;
    const merge = (/** @type {unknown} */ r) => ({ ...(typeof r === 'object' && r !== null ? r : {}), collapse: true });
    return own !== null && typeof own === 'object' && typeof (/** @type {{ then?: unknown }} */ (own).then) === 'function' ? /** @type {Promise<unknown>} */ (own).then(merge) : merge(own);
  };
}

/**
 * `withQuiesco()` options.
 * @typedef {{ enabled?: boolean; env?: NodeJS.ProcessEnv; projectRoot?: string; artifactsDir?: string | false; nativeModules?: boolean; argv?: readonly string[] }} WithQuiescoOptions
 */

/**
 * @template {{ projectRoot?: string; resolver?: { resolveRequest?: Function | null; blockList?: RegExp | RegExp[] | null }; serializer?: { getModulesRunBeforeMainModule?: (entryFilePath: string) => string[] }; symbolicator?: { customizeFrame?: ((frame: { file?: string }) => unknown) | null } }} T
 * @param {T} config Metro config (e.g. from expo/metro-config)
 * @param {WithQuiescoOptions} [options]
 *   `nativeModules`: wrap native modules for the `native-module` tracker (default:
 *   `EXPO_PUBLIC_QUIESCO_NATIVE_MODULES=1`). `argv`: Metro's command line (default: this process's).
 * @returns {T}
 */
function withQuiesco(config, options = {}) {
  const env = options.env ?? process.env;
  const enabled = options.enabled ?? isE2E(env);
  const projectRoot = options.projectRoot ?? config.projectRoot ?? process.cwd();
  const nativeModules = options.nativeModules ?? env.EXPO_PUBLIC_QUIESCO_NATIVE_MODULES === '1';
  const buildConfigFile = enabled ? writeBuildConfig(projectRoot, env, options.argv ?? process.argv.slice(2), Date.now(), { nativeModules }) : null;
  const upstream = config.resolver?.resolveRequest ?? null;
  const artifactsDir = options.artifactsDir ?? 'artifacts';
  const blockList = blockPaths(config.resolver?.blockList, {
    files: [path.join(projectRoot, '.expo', 'devices.json')],
    dirs: artifactsDir === false ? [] : [path.resolve(projectRoot, artifactsDir)],
  });

  /**
   * @param {{ originModulePath: string; resolveRequest: Function }} context
   * @param {string} moduleName
   * @param {string | null} platform
   */
  function resolveRequest(context, moduleName, platform) {
    if (!enabled && moduleName === AGENT) return { type: 'sourceFile', filePath: STUB };
    if (buildConfigFile !== null && moduleName === './build-config' && path.dirname(context.originModulePath) === AGENT_SRC) {
      return { type: 'sourceFile', filePath: buildConfigFile };
    }
    if (enabled && moduleName === 'expo/fetch' && path.resolve(context.originModulePath) !== EXPO_FETCH) {
      return { type: 'sourceFile', filePath: EXPO_FETCH };
    }
    return upstream !== null ? upstream(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
  }

  const resolver = { ...config.resolver, resolveRequest, blockList };
  if (!enabled) return { ...config, resolver };

  // Metro compares these paths with the (real) paths of modules in the graph.
  const early = fs.realpathSync(EARLY);
  const upstreamBefore = config.serializer?.getModulesRunBeforeMainModule;
  /** @param {string} entryFilePath */
  function getModulesRunBeforeMainModule(entryFilePath) {
    const rest = typeof upstreamBefore === 'function' ? upstreamBefore(entryFilePath) : [];
    return [early, ...rest.filter((p) => p !== early)];
  }
  // Expo's serializer (withExpoSerializers) captured the original `config.serializer` object in
  // getDefaultConfig() and reads getModulesRunBeforeMainModule from it when exporting (release
  // bundles); the dev server reads the returned config. Set it on both.
  if (config.serializer !== undefined && config.serializer !== null) config.serializer.getModulesRunBeforeMainModule = getModulesRunBeforeMainModule;
  return {
    ...config,
    resolver,
    serializer: { ...config.serializer, getModulesRunBeforeMainModule },
    symbolicator: { ...config.symbolicator, customizeFrame: collapseAgentFrames(config.symbolicator?.customizeFrame) },
  };
}

module.exports = { withQuiesco, isE2E, watchMode, isAgentFrame };
