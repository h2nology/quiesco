/**
 * Maps the cucumber-js lifecycle onto @quiesco/core's session API (requirements.md §6.10). Kept free of
 * cucumber imports so it can be unit-tested and mirrored by other runner adapters.
 */
import { QuiescoError, createSession, flattenTags, loadConfig, resolvePlatform, runsOnPlatform, tagNames } from '@quiesco/core';
import type { Platform, QuiescoConfig, ScenarioTags, Session, SessionOptions } from '@quiesco/core';

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
  fileName?: string;
}

export interface ScenarioResult {
  tags: readonly string[];
  failed: boolean;
}

interface TaggedNode {
  tags: readonly { id: string }[];
}
interface ScenarioNode extends TaggedNode {
  examples: readonly TaggedNode[];
}
interface FeatureChild {
  rule?: TaggedNode & { children: readonly FeatureChild[] };
  scenario?: ScenarioNode;
}
/** The parts of a cucumber-js GherkinDocument needed to place tags (structural, no cucumber import). */
export interface TagSource {
  feature?: (TaggedNode & { children: readonly FeatureChild[] }) | undefined;
}

/**
 * A pickle's tags grouped by Gherkin level: [feature, rule, scenario, examples]. Tags whose node is
 * not found count as scenario tags.
 */
export function tagLevels(pickleTags: readonly { name: string; astNodeId: string }[], doc: TagSource): string[][] {
  const level = new Map<string, number>();
  const mark = (node: TaggedNode, l: number) => node.tags.forEach((t) => level.set(t.id, l));
  const walk = (children: readonly FeatureChild[]) => {
    for (const c of children) {
      if (c.rule !== undefined) {
        mark(c.rule, 1);
        walk(c.rule.children);
      }
      if (c.scenario !== undefined) {
        mark(c.scenario, 2);
        c.scenario.examples.forEach((e) => mark(e, 3));
      }
    }
  };
  if (doc.feature !== undefined) {
    mark(doc.feature, 0);
    walk(doc.feature.children);
  }
  const out: string[][] = [[], [], [], []];
  for (const t of pickleTags) out[level.get(t.astNodeId) ?? 2]?.push(t.name);
  return out;
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

  /**
   * Before: `'skipped'` for scenarios tagged for other platforms, else reset the app. Pass the tags
   * grouped by Gherkin level ({@link tagLevels}) so the innermost platform tag decides.
   */
  async before(tags: ScenarioTags, name = 'scenario'): Promise<'skipped' | undefined> {
    if (this.config === null || this.platform === null) throw new Error('Quiesco BeforeAll did not complete');
    if (!runsOnPlatform(tags, this.platform, tagNames(this.config.tags))) return 'skipped';
    // Artifacts first: the reset is part of the scenario's video and timeline.
    await this.current.startScenario({ name });
    this.started = true;
    await this.current.beforeScenario({ tags: flattenTags(tags), name });
    return undefined;
  }

  /** Whether the current scenario started (not skipped): only then does it have artifacts to end. */
  private started = false;

  /**
   * After: on failure, evidence to attach (screenshot, element tree, idle state). On success, an app
   * error reported after the last step still fails the scenario.
   */
  async after(result: ScenarioResult): Promise<Attachment[]> {
    if (this.session === null) return [];
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
      // Skipped by platform (or the Before hook failed before the artifacts started): evidence only.
      return result.failed ? (await this.session.afterScenario({ failed: true })).attachments : [];
    }
    return (await this.session.afterScenario({ failed: result.failed })).attachments;
  }

  /** AfterAll: close the connection and the device (per config). */
  async afterAll(): Promise<void> {
    const s = this.session;
    this.session = null;
    await s?.dispose();
  }
}
