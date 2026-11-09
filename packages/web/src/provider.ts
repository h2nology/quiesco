/**
 * Web DeviceProvider (requirements.md §6.9): the Playwright library (never @playwright/test).
 * - boot: launch the browser; install: serve `distDir` (a static export with Quiesco's file server, a
 *   server export with `npx expo serve`) or check `url`;
 * - launch: a fresh browser context per app launch (cookies and storage isolated; hard reset = new
 *   context), connection parameters injected with addInitScript before any page script runs
 *   (docs/spikes/05), then open the app;
 * - injectInput: real mouse / touch / keyboard / wheel input at the coordinates the agent computed
 *   (CSS pixels, the same coordinate space as Playwright's mouse; docs/spikes/07).
 * - Phase 6.5: launch arguments in `window.__QUIESCO__.args`; `relaunch({ url })` opens the URL's path
 *   (`myapp://todos/1` → `/todos/1`); a relaunch that keeps data carries cookies, localStorage and
 *   IndexedDB over to the new context (Playwright storageState). No background state: a page driven by
 *   Playwright stays visible whatever is tried (findings 6.5 spike), so sendToBackground is not offered.
 */
import { LAUNCH_PARAM_PORT, LAUNCH_PARAM_SESSION, WEB_PARAMS_GLOBAL } from '@quiesco/protocol';
import type { HostInput, Orientation } from '@quiesco/protocol';
import type { ColorScheme, DeviceProvider, LaunchParams, LaunchUrlHandling, Logger, Permission, StateChange, WebAppConfig, WebDeviceConfig } from '@quiesco/core';
import { QuiescoError, silentLogger } from '@quiesco/core';
import { chromium, firefox, webkit } from 'playwright';
import type { Browser, BrowserContext, BrowserType, Page } from 'playwright';

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

/**
 * Where a launch URL points on the web: paths and http(s) URLs as they are; an app scheme URL
 * (`myapp://todos/1?x=1`) becomes its path (`/todos/1?x=1`), the route expo-router gives it natively.
 */
export function webPathFor(url: string): string {
  if (url.startsWith('/') || /^https?:\/\//i.test(url)) return url;
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)([^?#]*)(.*)$/i.exec(url);
  if (m === null) return `/${url.replace(/^\/+/, '')}`;
  const [, host = '', rest = '', tail = ''] = m;
  const pathPart = `/${[host, rest.replace(/^\/+/, '')].filter((x) => x !== '').join('/')}`;
  return `${pathPart}${tail}`;
}

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
  /** Cookies / storage of the last context, kept by terminate({ keepData: true }) for the next launch. */
  private kept: StorageState | null = null;
  /** Device state (Phase 6.6), applied to the open page and to every new context until reset. */
  private orientation: Orientation | null = null;
  private geolocation: { latitude: number; longitude: number } | null = null;
  private colorScheme: ColorScheme | null = null;
  private locale: string | null = null;
  /** Permissions granted at runtime beyond / revoked from the configured ones. */
  private permissionsAtStart: string[] | null = null;
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

  async launch(params: LaunchParams): Promise<LaunchUrlHandling | void> {
    if (this.browser === null || this.baseUrl === null) throw new QuiescoError('DEVICE_ERROR', 'web provider not booted / installed');
    if (this.context !== null) await this.terminate({ keepData: true });
    const kept = this.kept;
    this.kept = null;
    const vp = this.device.viewport;
    const size = this.viewportSize();
    const context = await this.browser.newContext({
      ...(vp !== undefined
        ? { viewport: size ?? { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor ?? 1, hasTouch: vp.hasTouch ?? false, isMobile: vp.isMobile ?? false }
        : {}),
      permissions: this.permissions,
      ...(kept !== null ? { storageState: kept } : {}),
      ...(this.geolocation !== null ? { geolocation: this.geolocation } : {}),
      ...(this.colorScheme !== null ? { colorScheme: this.colorScheme } : {}),
      ...(this.locale !== null ? { locale: this.locale } : {}),
    });
    await context.addInitScript(
      ({ key, port, session, args }) => {
        (globalThis as unknown as Record<string, unknown>)[key] = args === null ? { port, session } : { port, session, args };
      },
      { key: WEB_PARAMS_GLOBAL, port: params.port, session: params.sessionId, args: (params.argsObject ?? null) as never },
    );
    const page = await context.newPage();
    page.on('pageerror', (e) => {
      this.pageErrors.push(e.message);
      if (this.pageErrors.length > 20) this.pageErrors.shift();
    });
    this.context = context;
    this.page = page;
    const target = params.url !== undefined ? webPathFor(params.url) : (this.options.app.path ?? '/');
    await page.goto(new URL(target, this.baseUrl).href);
    if (params.url !== undefined) return 'delivered';
  }

  async terminate(opts: { keepData?: boolean } = {}): Promise<void> {
    const ctx = this.context;
    this.context = null;
    this.page = null;
    if (ctx === null) {
      if (opts.keepData !== true) this.kept = null;
      return;
    }
    this.kept = opts.keepData === true ? await ctx.storageState({ indexedDB: true }).catch(() => null) : null;
    await ctx.close();
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

  // ---- Phase 6.6 device state ----

  /** The configured viewport, turned to `this.orientation`; null without a configured viewport. */
  private viewportSize(): { width: number; height: number } | null {
    const vp = this.device.viewport;
    if (vp === undefined) return null;
    const long = Math.max(vp.width, vp.height);
    const short = Math.min(vp.width, vp.height);
    if (this.orientation === 'landscape') return { width: long, height: short };
    if (this.orientation === 'portrait') return { width: short, height: long };
    return { width: vp.width, height: vp.height };
  }

  /** Swaps the viewport's sides (a `resize` for the page; `screen.orientation` follows). */
  async setOrientation(orientation: Orientation): Promise<void> {
    if (this.device.viewport === undefined) {
      throw new QuiescoError('ACTION_NOT_SUPPORTED', 'setOrientation on the web needs a configured viewport (devices.web.viewport)', { action: 'setOrientation', platform: 'web' });
    }
    this.orientation = orientation;
    await this.requirePage().setViewportSize(this.viewportSize() as { width: number; height: number });
  }

  async setLocation(location: { latitude: number; longitude: number }): Promise<void> {
    this.geolocation = { ...location };
    await this.context?.setGeolocation(this.geolocation);
  }

  async setPermission(permission: Permission, grant: boolean): Promise<StateChange> {
    const name = WEB_PERMISSIONS[permission];
    if (name === undefined) {
      throw new QuiescoError('ACTION_NOT_SUPPORTED', `the "${permission}" permission does not exist on the web`, { action: 'setPermission', platform: 'web' });
    }
    if (this.permissionsAtStart === null) this.permissionsAtStart = [...this.permissions];
    this.permissions = grant ? [...new Set([...this.permissions, name])] : this.permissions.filter((p) => p !== name);
    // Playwright cannot revoke a single permission: clear all, grant the rest again.
    await this.context?.clearPermissions();
    if (this.permissions.length > 0) await this.context?.grantPermissions(this.permissions);
    return { relaunch: false };
  }

  async setAppearance(scheme: ColorScheme): Promise<void> {
    this.colorScheme = scheme;
    await this.requirePage().emulateMedia({ colorScheme: scheme });
  }

  /** A browser context's locale is fixed when it is created: the app is opened again in a new one (data kept). */
  async setLocale(locale: string | null): Promise<StateChange> {
    const changed = this.locale !== locale;
    this.locale = locale;
    return { relaunch: changed };
  }

  async resetDeviceState(): Promise<StateChange> {
    const page = this.page;
    if (this.orientation !== null) {
      this.orientation = null;
      const vp = this.device.viewport;
      if (page !== null && vp !== undefined) await page.setViewportSize({ width: vp.width, height: vp.height });
    }
    if (this.geolocation !== null) {
      this.geolocation = null;
      await this.context?.setGeolocation(null);
    }
    if (this.colorScheme !== null) {
      this.colorScheme = null;
      await page?.emulateMedia({ colorScheme: null });
    }
    if (this.permissionsAtStart !== null) {
      this.permissions = this.permissionsAtStart;
      this.permissionsAtStart = null;
    }
    const relaunch = this.locale !== null;
    this.locale = null;
    return { relaunch };
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
