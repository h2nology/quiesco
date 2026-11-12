/**
 * The test-run lifecycle every runner adapter maps onto (requirements.md §6.10; Phase 6.10): one session
 * for the run, a reset before each test, evidence after a failure. `@quiesco/cucumber`, `@quiesco/jest`
 * and `@quiesco/vitest` only translate their runner's hooks and results into these calls; core stays
 * free of any runner import.
 */
import type { Attachment } from './artifacts.js';
import { loadConfig, resolvePlatform } from './config.js';
import type { QuiescoConfig } from './config.js';
import type { Platform } from '@quiesco/protocol';
import { SERIAL_WORKER } from './devices/provider.js';
import type { WorkerInfo } from './devices/provider.js';
import { createSession } from './session.js';
import type { Session, SessionOptions } from './session.js';
import { flattenTags, runsOnPlatform, tagNames } from './tags.js';
import type { ScenarioTags } from './tags.js';

export interface LifecycleOptions {
  /** Config instead of loading `quiesco.config.*` (QUIESCO_CONFIG picks another file). */
  config?: QuiescoConfig;
  /** Platform instead of QUIESCO_PLATFORM. */
  platform?: Platform;
  /** Session factory (tests, custom setups). */
  createSession?: (options: SessionOptions) => Promise<Session>;
  env?: NodeJS.ProcessEnv;
  /**
   * The parallel worker this lifecycle runs in (Phase 6.12), from the runner adapter: the config function
   * gets it, and the session takes its own device, port and artifacts directory. Default: the only worker.
   */
  worker?: WorkerInfo;
}

export interface ScenarioResult {
  tags: readonly string[];
  failed: boolean;
}

export interface AfterResult {
  /** For runners with attachments: screenshot, element tree, logs, … */
  attachments: Attachment[];
  /** Files written for this test (evidence, logs, video): runners without attachments print them. */
  files: string[];
}

/** Tags written in a test or suite title: `test('adds a todo @ios @smoke', …)` → ['@ios', '@smoke']. */
export function titleTags(title: string): string[] {
  return title.match(/(?<=^|\s)@[^\s@]+/g) ?? [];
}

export class Lifecycle {
  private session: Session | null = null;
  private config: QuiescoConfig | null = null;
  private platform: Platform | null = null;
  /** Whether the current test started (not skipped): only then does it have artifacts to end. */
  private started = false;

  constructor(private readonly options: LifecycleOptions = {}) {}

  get current(): Session {
    if (this.session === null) throw new Error('Quiesco session is not running (beforeAll did not complete)');
    return this.session;
  }

  get running(): boolean {
    return this.session !== null;
  }

  /** Load the config, start the server and device, launch the app, wait for the agent. */
  async beforeAll(): Promise<void> {
    const env = this.options.env ?? process.env;
    const worker = this.options.worker ?? SERIAL_WORKER;
    this.config =
      this.options.config ??
      (await loadConfig({ ...(env['QUIESCO_CONFIG'] !== undefined ? { file: env['QUIESCO_CONFIG'] } : {}), worker: { workerIndex: worker.index, workerCount: worker.count } })).config;
    this.platform = this.options.platform ?? resolvePlatform(undefined, env);
    this.session = await (this.options.createSession ?? createSession)({ config: this.config, platform: this.platform, worker });
  }

  /** Whether a test with these tags (grouped outermost level first) runs on this run's platform. */
  runsHere(tags: ScenarioTags): boolean {
    if (this.config === null || this.platform === null) throw new Error('Quiesco beforeAll did not complete');
    return runsOnPlatform(tags, this.platform, tagNames(this.config.tags));
  }

  /**
   * Before each test: `'skipped'` for tests tagged for other platforms, else reset the app. Pass the
   * tags grouped by level (suite / feature first) so the innermost platform tag decides.
   */
  async before(tags: ScenarioTags, name = 'scenario'): Promise<'skipped' | undefined> {
    if (!this.runsHere(tags)) return 'skipped';
    // Artifacts first: the reset is part of the test's video and timeline.
    await this.current.startScenario({ name });
    this.started = true;
    await this.current.beforeScenario({ tags: flattenTags(tags), name });
    return undefined;
  }

  /**
   * After each test: on failure, the evidence. On success, an app error reported after the last step
   * still fails the test (thrown).
   */
  async after(result: ScenarioResult): Promise<AfterResult> {
    if (this.session === null) return { attachments: [], files: [] };
    const started = this.started;
    this.started = false;
    if (!result.failed) {
      const late = this.session.driver.takeAppError();
      if (late !== null) {
        if (started) await this.session.afterScenario({ failed: true }).catch(() => undefined);
        throw late;
      }
    }
    if (!started) {
      // Skipped by platform (or the before hook failed before the artifacts started): evidence only.
      return result.failed ? await this.session.afterScenario({ failed: true }) : { attachments: [], files: [] };
    }
    return this.session.afterScenario({ failed: result.failed });
  }

  /** Close the connection and the device (per config). */
  async afterAll(): Promise<void> {
    const s = this.session;
    this.session = null;
    await s?.dispose();
  }
}
