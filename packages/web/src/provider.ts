/**
 * Web DeviceProvider (requirements.md §6.9): the Playwright library (never @playwright/test).
 * - boot: launch the browser; install: serve `distDir` (a static export with Quiesco's file server, a
 *   server export with `npx expo serve`) or check `url`;
 * - launch: a fresh browser context per app launch (cookies and storage isolated; hard reset = new
 *   context), connection parameters injected with addInitScript before any page script runs
 *   (docs/spikes/05), then open the app;
 * - injectInput: real mouse / touch / keyboard / wheel input at the coordinates the agent computed
 *   (CSS pixels, the same coordinate space as Playwright's mouse; docs/spikes/07).
 */
import { LAUNCH_PARAM_PORT, LAUNCH_PARAM_SESSION, WEB_PARAMS_GLOBAL } from '@quiesco/protocol';
import type { HostInput } from '@quiesco/protocol';
import type { DeviceProvider, LaunchParams, Logger, Permission, WebAppConfig, WebDeviceConfig } from '@quiesco/core';
import { QuiescoError, silentLogger } from '@quiesco/core';
import { chromium, firefox, webkit } from 'playwright';
import type { Browser, BrowserContext, BrowserType, Page } from 'playwright';

import { isServerExport, startExpoServer } from './expo-server.js';
import { startStaticServer } from './static-server.js';
import type { StaticServer } from './static-server.js';

const BROWSERS: Record<NonNullable<WebDeviceConfig['browser']>, BrowserType> = { chromium, firefox, webkit };

const WEB_PERMISSIONS: Partial<Record<Permission, string>> = {
  camera: 'camera',
  microphone: 'microphone',
  location: 'geolocation',
  notifications: 'notifications',
};

export interface WebProviderOptions {
  app: WebAppConfig;
  device?: WebDeviceConfig;
  logger?: Logger;
}

export class WebProvider implements DeviceProvider {
  readonly platform = 'web' as const;
  /**
   * react-native-gesture-handler on the web: span slop 2 × 15 px before the scale detector starts, then
   * 15 px more before the pinch activates (resetting its scale); measured about 46 px. Its rotation keeps
   * the angle turned before activating (measured: 90° reported for 90° turned), so no rotation slop.
   */
  readonly gestureSlop = { pinch: 46, rotation: 0 };
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private server: StaticServer | null = null;
  private baseUrl: string | null = null;
  private permissions: string[] = [];
  private readonly pageErrors: string[] = [];
  private readonly logger: Logger;

  constructor(private readonly options: WebProviderOptions) {
    this.logger = options.logger ?? silentLogger;
    if (options.app.distDir === undefined && options.app.url === undefined) {
      throw new QuiescoError('CONFIG_ERROR', 'apps.web needs distDir (static export) or url (dev server)');
    }
  }

  private get device(): WebDeviceConfig {
    return this.options.device ?? {};
  }

  async boot(): Promise<void> {
    const name = this.device.browser ?? 'chromium';
    this.browser = await BROWSERS[name].launch({ headless: this.device.headless ?? true }).catch((e: unknown) => {
      throw new QuiescoError('DEVICE_ERROR', `Cannot launch ${name}: ${(e as Error).message}. Install it with \`npx playwright install ${name}\`.`);
    });
  }

  async install(): Promise<void> {
    const { distDir, url } = this.options.app;
    if (distDir !== undefined) {
      const server = isServerExport(distDir);
      if (server) this.logger.info(`${distDir} is a server export (web.output: "server"); starting \`npx expo serve\``);
      this.server = await (server ? startExpoServer(distDir) : startStaticServer(distDir)).catch((e: unknown) => {
        throw new QuiescoError('CONFIG_ERROR', (e as Error).message);
      });
      this.baseUrl = this.server.url;
      return;
    }
    const target = url as string;
    const res = await fetch(target).catch((e: unknown) => {
      throw new QuiescoError('DEVICE_ERROR', `${target} is not reachable (${(e as Error).message}); is the dev server running with EXPO_PUBLIC_QUIESCO=1?`);
    });
    if (!res.ok) throw new QuiescoError('DEVICE_ERROR', `${target} answered ${res.status}`);
    this.baseUrl = target;
  }

  async launch(params: LaunchParams): Promise<void> {
    if (this.browser === null || this.baseUrl === null) throw new QuiescoError('DEVICE_ERROR', 'web provider not booted / installed');
    await this.terminate();
    const vp = this.device.viewport;
    const context = await this.browser.newContext({
      ...(vp !== undefined
        ? { viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor ?? 1, hasTouch: vp.hasTouch ?? false, isMobile: vp.isMobile ?? false }
        : {}),
      permissions: this.permissions,
    });
    await context.addInitScript(
      ({ key, port, session }) => {
        (globalThis as unknown as Record<string, unknown>)[key] = { port, session };
      },
      { key: WEB_PARAMS_GLOBAL, port: params.port, session: params.sessionId },
    );
    const page = await context.newPage();
    page.on('pageerror', (e) => {
      this.pageErrors.push(e.message);
      if (this.pageErrors.length > 20) this.pageErrors.shift();
    });
    this.context = context;
    this.page = page;
    await page.goto(new URL(this.options.app.path ?? '/', this.baseUrl).href);
  }

  async terminate(): Promise<void> {
    const ctx = this.context;
    this.context = null;
    this.page = null;
    await ctx?.close();
  }

  async grantPermissions(perms: readonly Permission[]): Promise<void> {
    this.permissions = [];
    for (const p of perms) {
      const name = WEB_PERMISSIONS[p];
      if (name === undefined) this.logger.warn(`permission "${p}" is not supported on the web; skipped`);
      else this.permissions.push(name);
    }
    await this.context?.grantPermissions(this.permissions);
  }

  async screenshot(): Promise<Buffer> {
    return this.requirePage().screenshot();
  }

  async injectInput(input: HostInput): Promise<void> {
    const page = this.requirePage();
    switch (input.kind) {
      case 'tap': {
        const count = input.count ?? 1;
        const touch = this.device.viewport?.hasTouch === true;
        if (touch && count === 1 && input.holdMs === undefined) {
          await page.touchscreen.tap(input.x, input.y);
          return;
        }
        await page.mouse.move(input.x, input.y);
        for (let i = 0; i < count; i++) {
          await page.mouse.down({ clickCount: i + 1 });
          if (input.holdMs !== undefined) await new Promise((r) => setTimeout(r, input.holdMs));
          await page.mouse.up({ clickCount: i + 1 });
        }
        return;
      }
      case 'type':
        await page.mouse.click(input.x, input.y);
        if (input.clearFirst === true) {
          await page.keyboard.press('ControlOrMeta+A');
          await page.keyboard.press('Backspace');
        }
        if (input.text !== '') await page.keyboard.type(input.text);
        return;
      case 'drag': {
        const steps = Math.max(4, Math.round(input.durationMs / 16));
        await page.mouse.move(input.from.x, input.from.y);
        await page.mouse.down();
        // Press-and-hold first (long-press-activated drags), then move in small steps.
        if (input.holdMs !== undefined && input.holdMs > 0) await new Promise((r) => setTimeout(r, input.holdMs));
        await page.mouse.move(input.to.x, input.to.y, { steps });
        await page.mouse.up();
        return;
      }
      case 'wheel':
        await page.mouse.move(input.x, input.y);
        await page.mouse.wheel(input.dx, input.dy);
        return;
      case 'key':
        await page.keyboard.press(input.key);
        return;
      case 'touches':
        await this.playTouches(page, input.fingers, input.frames);
        return;
      case 'select':
      case 'fill': {
        // The form control at the point (the agent checked that nothing covers it).
        const handle = await page.evaluateHandle(({ x, y }) => document.elementFromPoint(x, y), { x: input.x, y: input.y });
        const el = handle.asElement();
        try {
          const tag = el === null ? null : await el.evaluate((e) => e.tagName);
          const fits = input.kind === 'select' ? tag === 'SELECT' : tag === 'INPUT' || tag === 'TEXTAREA';
          // Otherwise Playwright would wait for the element to become editable until its own timeout.
          if (el === null || !fits) throw new QuiescoError('DEVICE_ERROR', `no ${input.kind === 'select' ? '<select>' : 'form field'} at (${Math.round(input.x)}, ${Math.round(input.y)}) (found ${tag ?? 'nothing'})`);
          if (input.kind === 'select') await el.selectOption(input.value);
          else await el.fill(input.value);
        } finally {
          await handle.dispose();
        }
        return;
      }
      case 'navigate':
        await page.goto(new URL(input.url, this.baseUrl ?? undefined).href);
        return;
      case 'back':
        await page.goBack();
        return;
    }
  }

  async shutdown(): Promise<void> {
    await this.terminate().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
    await this.server?.close();
    this.server = null;
  }

  async diagnose(params: LaunchParams): Promise<string[]> {
    const lines = [`Page: ${this.page?.url() ?? '(none)'}; Quiesco params injected as window.${WEB_PARAMS_GLOBAL} = { port: ${params.port}, session }.`];
    lines.push(`The bundle must be an e2e build (EXPO_PUBLIC_QUIESCO=1) so it reads ${LAUNCH_PARAM_PORT} / ${LAUNCH_PARAM_SESSION} from there.`);
    if (this.pageErrors.length > 0) lines.push(`Page errors: ${this.pageErrors.slice(-3).join(' | ')}`);
    return lines;
  }

  /**
   * Multi-finger touches through CDP `Input.dispatchTouchEvent` (Playwright has no multi-touch API):
   * per frame the fingers that went down (touchStart), moved (touchMove) and lifted (touchEnd), each
   * event listing the fingers touching after it, as CDP expects. Touch viewports only: a page on a
   * viewport without touch does not expect touch events (HU 2026-11-09).
   */
  private async playTouches(page: Page, fingers: number, frames: number[]): Promise<void> {
    if (this.device.viewport?.hasTouch !== true) {
      throw new QuiescoError('ACTION_NOT_SUPPORTED', 'multi-finger gestures (pinch, rotate, multiTouch) need a touch viewport on the web', {
        action: 'multiTouch',
        platform: 'web',
        hint: 'run the scenario with a viewport that has hasTouch: true (phone / tablet), or tag it for touch platforms only',
      });
    }
    const cdp = await page.context().newCDPSession(page);
    const stride = 1 + 3 * fingers;
    const down = new Map<number, { x: number; y: number }>();
    const send = (type: 'touchStart' | 'touchMove' | 'touchEnd'): Promise<unknown> =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...down].map(([id, p]) => ({ id, x: p.x, y: p.y, radiusX: 5, radiusY: 5, force: 1 })) });
    const start = Date.now();
    try {
      for (let k = 0; k + stride <= frames.length; k += stride) {
        const wait = start + (frames[k] as number) - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        const now = new Map<number, { x: number; y: number }>();
        for (let i = 0; i < fingers; i++) {
          const o = k + 1 + 3 * i;
          if ((frames[o] as number) > 0.5) now.set(i, { x: frames[o + 1] as number, y: frames[o + 2] as number });
        }
        const started = [...now.keys()].filter((i) => !down.has(i));
        const lifted = [...down.keys()].filter((i) => !now.has(i));
        const moved = [...now].some(([i, p]) => down.has(i) && (down.get(i)?.x !== p.x || down.get(i)?.y !== p.y));
        if (started.length > 0) {
          for (const i of started) down.set(i, now.get(i) as { x: number; y: number });
          await send('touchStart');
        }
        if (moved) {
          for (const [i, p] of now) if (down.has(i)) down.set(i, p);
          await send('touchMove');
        }
        if (lifted.length > 0) {
          for (const i of lifted) down.delete(i);
          await send('touchEnd');
        }
      }
      if (down.size > 0) {
        down.clear();
        await send('touchEnd');
      }
    } finally {
      await cdp.detach().catch(() => undefined);
    }
  }

  private requirePage(): Page {
    if (this.page === null) throw new QuiescoError('DEVICE_ERROR', 'no page open (launch() first)');
    return this.page;
  }
}

/** Entry used by @quiesco/core's createProvider('web') (loaded at runtime by name). */
export function createWebProvider(options: WebProviderOptions): DeviceProvider {
  return new WebProvider(options);
}
