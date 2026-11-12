/**
 * Per-scenario artifacts (Phase 6.9, HU 2026-11-10): video, device logs, the timeline, screenshots the
 * test saved by name, and the failure evidence — written under `<dir>/<run>/<scenario>/` and returned as
 * attachments for the runner's report (small ones inline, large ones as a file path). Runner-independent:
 * the Cucumber hooks call it through the session, other runners can do the same.
 *
 * Policies: `none`, `failing` (recorded for every scenario, kept only when it fails) or `all`.
 * Defaults: video none, logs and timeline failing; `QUIESCO_ARTIFACTS=<policy>` sets all three.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import type { DeviceProvider, WorkerInfo } from './devices/provider.js';
import type { Logger } from './logger.js';
import { Timeline } from './timeline.js';

export type ArtifactPolicy = 'none' | 'failing' | 'all';

export interface ArtifactsConfig {
  /** Where runs are written (relative to the working directory). Default `artifacts`. */
  dir?: string;
  video?: ArtifactPolicy;
  logs?: ArtifactPolicy;
  timeline?: ArtifactPolicy;
}

export interface Attachment {
  data: Buffer | string;
  mediaType: string;
  /** Shown by reporters that name attachments. */
  fileName?: string;
}

export interface ScenarioArtifacts {
  /** For the report: screenshots, logs and the timeline summary inline; videos / traces by path. */
  attachments: Attachment[];
  /** Files written for this scenario. */
  files: string[];
}

/** Lines of the device log put inline in the report (the whole log is in the file). */
const LOG_TAIL = 300;
const POLICIES: readonly ArtifactPolicy[] = ['none', 'failing', 'all'];

export function resolveArtifacts(config: ArtifactsConfig | undefined, env: NodeJS.ProcessEnv = process.env): Required<ArtifactsConfig> {
  const all = env['QUIESCO_ARTIFACTS'];
  if (all !== undefined && !POLICIES.includes(all as ArtifactPolicy)) throw new RangeError(`QUIESCO_ARTIFACTS must be none, failing or all, got ${all}`);
  const pick = (v: ArtifactPolicy | undefined, def: ArtifactPolicy, name: string): ArtifactPolicy => {
    if (all !== undefined) return all as ArtifactPolicy;
    if (v !== undefined && !POLICIES.includes(v)) throw new RangeError(`artifacts.${name} must be none, failing or all, got ${String(v)}`);
    return v ?? def;
  };
  return {
    dir: config?.dir ?? 'artifacts',
    video: pick(config?.video, 'none', 'video'),
    logs: pick(config?.logs, 'failing', 'logs'),
    timeline: pick(config?.timeline, 'failing', 'timeline'),
  };
}

/** A file-system-safe name. */
export function slug(name: string): string {
  const s = name
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex -- control characters are not allowed in file names
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return (s === '' ? 'scenario' : s).slice(0, 80);
}

const keep = (policy: ArtifactPolicy, failed: boolean): boolean => policy === 'all' || (policy === 'failing' && failed);

interface Current {
  name: string;
  dir: string;
  start: number;
  attachments: Attachment[];
  files: string[];
  video: boolean;
}

/** `-w<N>` for parallel workers, '' when running serially (the run directory keeps its old name). */
export function workerSuffix(worker: WorkerInfo | undefined): string {
  return worker === undefined || worker.count <= 1 ? '' : `-w${worker.index}`;
}

export class Artifacts {
  readonly timeline = new Timeline();
  readonly config: Required<ArtifactsConfig>;
  private runDir: string | null = null;
  private count = 0;
  private current: Current | null = null;
  private logsStarted = false;

  constructor(
    private readonly options: {
      config?: ArtifactsConfig;
      provider: DeviceProvider;
      logger: Logger;
      env?: NodeJS.ProcessEnv;
      cwd?: string;
      /** Parallel runs (Phase 6.12): each worker writes to its own run directory, `…-<platform>-w<N>`. */
      worker?: WorkerInfo;
    },
  ) {
    this.config = resolveArtifacts(options.config, options.env);
  }

  /** `<dir>/<date-time>-<platform>` (`-w<N>` per parallel worker), created on first use. */
  private run(): string {
    if (this.runDir === null) {
      const d = new Date();
      const p = (n: number): string => String(n).padStart(2, '0');
      const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
      this.runDir = path.resolve(this.options.cwd ?? process.cwd(), this.config.dir, `${stamp}-${this.options.provider.platform}${workerSuffix(this.options.worker)}`);
    }
    return this.runDir;
  }

  /** Start a scenario: its timeline, its video, the device log (once per session). */
  async beginScenario(name: string): Promise<void> {
    if (this.current !== null) await this.endScenario({ failed: false }).catch(() => undefined);
    this.count++;
    const dir = path.join(this.run(), `${String(this.count).padStart(3, '0')}-${slug(name)}`);
    this.current = { name, dir, start: Date.now(), attachments: [], files: [], video: false };
    this.timeline.reset(name);
    const p = this.options.provider;
    if (this.config.logs !== 'none' && !this.logsStarted && p.startDeviceLogs !== undefined) {
      this.logsStarted = true;
      await p.startDeviceLogs().catch((e: unknown) => this.options.logger.warn(`device logs are not available: ${(e as Error).message}`));
    }
    if (this.config.video !== 'none') {
      if (p.startVideo === undefined) {
        this.options.logger.warn(`artifacts.video: ${p.platform} cannot record video`);
      } else {
        await fs.mkdir(dir, { recursive: true });
        await p.startVideo(path.join(dir, 'video')).then(
          () => void (this.current !== null && (this.current.video = true)),
          (e: unknown) => this.options.logger.warn(`recording a video failed: ${(e as Error).message}`),
        );
      }
    }
  }

  /**
   * A file the test saves by name (e.g. `app.device.screenshot(t, { name })`), attached to the report. Outside a
   * scenario it goes to the run directory.
   */
  async save(name: string, data: Buffer, mediaType: string, ext: string): Promise<string> {
    const dir = this.current?.dir ?? this.run();
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${slug(name)}${ext}`);
    await fs.writeFile(file, data);
    if (this.current !== null) {
      this.current.files.push(file);
      this.current.attachments.push({ data, mediaType, fileName: path.basename(file) });
    }
    return file;
  }

  /**
   * End the scenario: stop its video, then keep (or drop) video, logs and timeline per policy. `evidence`
   * (failure screenshot, element tree, ...) is written next to them and attached first.
   */
  async endScenario(result: { failed: boolean; evidence?: Attachment[] }): Promise<ScenarioArtifacts> {
    const cur = this.current;
    this.current = null;
    if (cur === null) return { attachments: result.evidence ?? [], files: [] };
    const p = this.options.provider;
    const attachments: Attachment[] = [];
    const files = [...cur.files];
    const write = async (name: string, data: Buffer | string): Promise<string> => {
      await fs.mkdir(cur.dir, { recursive: true });
      const file = path.join(cur.dir, name);
      await fs.writeFile(file, data);
      files.push(file);
      return file;
    };

    for (const [i, e] of (result.evidence ?? []).entries()) {
      const ext = e.mediaType === 'image/png' ? '.png' : e.mediaType === 'application/json' ? '.json' : '.txt';
      const name = e.fileName ?? `failure-${i + 1}${ext}`;
      await write(name, e.data).catch(() => undefined);
      attachments.push({ ...e, fileName: name });
    }

    if (cur.video) {
      const videos = await p.stopVideo?.().catch((e: unknown) => {
        this.options.logger.warn(`stopping the video failed: ${(e as Error).message}`);
        return [] as string[];
      });
      for (const v of videos ?? []) {
        if (keep(this.config.video, result.failed)) {
          files.push(v);
          attachments.push({ data: `Video: ${v}`, mediaType: 'text/plain' });
        } else {
          await fs.rm(v, { force: true });
        }
      }
    }

    if (keep(this.config.logs, result.failed) && p.deviceLogs !== undefined) {
      const lines = p.deviceLogs(cur.start);
      if (lines.length > 0) {
        await write('device.log', `${lines.join('\n')}\n`);
        const tail = lines.length > LOG_TAIL ? [`… ${lines.length - LOG_TAIL} earlier lines in device.log`, ...lines.slice(-LOG_TAIL)] : lines;
        attachments.push({ data: tail.join('\n'), mediaType: 'text/plain', fileName: 'device.log' });
      }
    }

    if (keep(this.config.timeline, result.failed) && this.timeline.all.length > 0) {
      const trace = await write('timeline.trace.json', this.timeline.toTrace());
      const html = this.timeline.toHtml();
      await write('timeline.html', html);
      attachments.push({ data: html, mediaType: 'text/html', fileName: 'timeline.html' });
      attachments.push({ data: `Timeline trace (chrome://tracing, ui.perfetto.dev): ${trace}`, mediaType: 'text/plain' });
    }

    attachments.push(...cur.attachments);
    // Nothing kept: no empty directory left behind.
    await fs.rmdir(cur.dir).catch(() => undefined);
    return { attachments, files };
  }

  /** Session end: a scenario still open is closed as passed; device logs stop with the provider. */
  async dispose(): Promise<void> {
    if (this.current !== null) await this.endScenario({ failed: false }).catch(() => undefined);
  }
}
