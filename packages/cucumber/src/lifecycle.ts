/**
 * Maps the cucumber-js lifecycle onto @quiesco/core's session API (requirements.md §6.10). Kept free of
 * cucumber imports so it can be unit-tested and mirrored by other runner adapters.
 */
import { QuiescoError, createSession, loadConfig, resolvePlatform, runsOnPlatform, tagNames } from '@quiesco/core';
import type { Platform, QuiescoConfig, Session, SessionOptions } from '@quiesco/core';

export interface LifecycleOptions {
  /** Config instead of loading `quiesco.config.*` (QUIESCO_CONFIG picks another file). */
  config?: QuiescoConfig;
  /** Platform instead of QUIESCO_PLATFORM. */
  platform?: Platform;
  /** Session factory (tests, custom setups). */
  createSession?: (options: SessionOptions) => Promise<Session>;
  env?: NodeJS.ProcessEnv;
}

export interface Attachment {
  data: Buffer | string;
  mediaType: string;
}

export interface ScenarioResult {
  tags: readonly string[];
  failed: boolean;
}

export class Lifecycle {
  private session: Session | null = null;
  private config: QuiescoConfig | null = null;
  private platform: Platform | null = null;

  constructor(private readonly options: LifecycleOptions = {}) {}

  get current(): Session {
    if (this.session === null) throw new Error('Quiesco session is not running (BeforeAll did not complete)');
    return this.session;
  }

  /** BeforeAll: load the config, start the server and device, launch the app, wait for the agent. */
  async beforeAll(): Promise<void> {
    const env = this.options.env ?? process.env;
    // cucumber-js --parallel runs worker threads that would all launch the same device and port.
    if (Number.parseInt(env['CUCUMBER_TOTAL_WORKERS'] ?? '1', 10) > 1) {
      throw new QuiescoError('CONFIG_ERROR', 'Quiesco does not support cucumber-js --parallel: every worker would drive the same device. Run the features serially (drop --parallel).');
    }
    this.config = this.options.config ?? (await loadConfig(env['QUIESCO_CONFIG'] !== undefined ? { file: env['QUIESCO_CONFIG'] } : {})).config;
    this.platform = this.options.platform ?? resolvePlatform(undefined, env);
    this.session = await (this.options.createSession ?? createSession)({ config: this.config, platform: this.platform });
  }

  /** Before: `'skipped'` for scenarios tagged for other platforms, else reset the app. */
  async before(tags: readonly string[]): Promise<'skipped' | undefined> {
    if (this.config === null || this.platform === null) throw new Error('Quiesco BeforeAll did not complete');
    if (!runsOnPlatform(tags, this.platform, tagNames(this.config.tags))) return 'skipped';
    await this.current.beforeScenario({ tags });
    return undefined;
  }

  /**
   * After: on failure, evidence to attach (screenshot, element tree, idle state). On success, an app
   * error reported after the last step still fails the scenario.
   */
  async after(result: ScenarioResult): Promise<Attachment[]> {
    if (this.session === null) return [];
    if (!result.failed) {
      const late = this.session.driver.takeAppError();
      if (late !== null) throw late;
      return [];
    }
    const ev = await this.session.collectEvidence();
    const out: Attachment[] = [];
    if (ev.screenshot !== undefined) out.push({ data: ev.screenshot, mediaType: 'image/png' });
    if (ev.tree !== undefined) out.push({ data: JSON.stringify({ elementTree: ev.tree }, null, 2), mediaType: 'application/json' });
    if (ev.idle !== undefined) out.push({ data: JSON.stringify({ idleState: ev.idle }, null, 2), mediaType: 'application/json' });
    if (ev.errors.length > 0) out.push({ data: `Quiesco could not collect: ${ev.errors.join('; ')}`, mediaType: 'text/plain' });
    return out;
  }

  /** AfterAll: close the connection and the device (per config). */
  async afterAll(): Promise<void> {
    const s = this.session;
    this.session = null;
    await s?.dispose();
  }
}
