import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NativeModuleTracker } from '../../src/sync';
import type { Clock, ModuleRegistryLike } from '../../src/sync';

const clock: Clock = { setTimeout: (cb, ms) => setTimeout(cb, ms), clearTimeout: (id) => clearTimeout(id as number), now: () => Date.now() };

/** A promise the test settles. */
function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A "host object" module: methods that need `this` to be the module itself. */
function storageModule() {
  const calls: unknown[] = [];
  const pending = deferred();
  const module = {
    tag: 'storage',
    setItem(this: { tag: string }, key: string) {
      calls.push([this.tag, key]);
      return pending.promise;
    },
    getConstants() {
      return { sync: true };
    },
  };
  return { module, calls, pending };
}

function setup(sources: { registry?: ModuleRegistryLike | null; expo?: { modules?: Record<string, unknown> } | null }, wrap?: boolean) {
  const tracker = new NativeModuleTracker({
    sources: { registry: () => sources.registry ?? null, expo: () => sources.expo ?? null },
    clock,
    skip: ['QuiescoNative'],
    ...(wrap !== undefined ? { wrap } : {}),
  });
  tracker.install();
  return tracker;
}

describe('NativeModuleTracker (#67)', () => {
  beforeEach(() => vi.useFakeTimers({ now: 0 }));
  afterEach(() => vi.useRealTimers());

  it('counts a pending promise of a module taken from TurboModuleRegistry until it settles', async () => {
    const s = storageModule();
    const registry: ModuleRegistryLike = { get: (name) => (name === 'PlatformLocalStorage' ? s.module : null), getEnforcing: () => s.module };
    const tracker = setup({ registry });
    tracker.configure({ enabled: true });
    const storage = registry.get!('PlatformLocalStorage') as typeof s.module;
    expect(registry.get!('PlatformLocalStorage')).toBe(storage); // one proxy per module
    expect(registry.get!('Missing')).toBeNull();
    const p = storage.setItem('token');
    expect(s.calls).toEqual([['storage', 'token']]); // called with the module as `this`
    expect(tracker.isIdle()).toBe(false);
    expect(tracker.describeBusy()).toEqual(['PlatformLocalStorage.setItem() 0ms']);
    expect(storage.getConstants()).toEqual({ sync: true }); // not a promise: nothing to track
    s.pending.resolve();
    await p;
    expect(tracker.isIdle()).toBe(true);
  });

  it('counts Expo modules too, and a rejected promise ends the call', async () => {
    const s = storageModule();
    const expo = { modules: { ExpoSecureStore: s.module } as Record<string, unknown> };
    const tracker = setup({ expo });
    tracker.configure({ enabled: true });
    const store = expo.modules['ExpoSecureStore'] as typeof s.module;
    const setItem = store.setItem as unknown as (key: string) => Promise<void>; // detached: `this` is the module all the same
    const p = setItem('k').catch(() => undefined);
    expect(s.calls).toEqual([['storage', 'k']]);
    expect(tracker.isIdle()).toBe(false);
    s.pending.reject(new Error('denied'));
    await p;
    expect(tracker.isIdle()).toBe(true);
  });

  it('counts a callback-style call until it calls one of its callbacks (#107: AsyncStorage 2 multiSet)', () => {
    let saved: ((errors?: unknown) => void) | undefined;
    const calls: unknown[] = [];
    const module = {
      tag: 'RNCAsyncStorage',
      multiSet(this: { tag: string }, pairs: [string, string][], callback: (errors?: unknown) => void) {
        calls.push([this.tag, pairs]);
        saved = callback;
      },
      multiGet(_keys: string[], callback: (errors?: unknown, result?: unknown) => void) {
        callback(undefined, []); // calls back at once
      },
      multiRemove(_keys: string[], _callback: () => void) {
        throw new Error('bad key');
      },
    };
    const registry: ModuleRegistryLike = { get: () => module };
    const tracker = setup({ registry });
    tracker.configure({ enabled: true });
    const storage = registry.get!('RNCAsyncStorage') as typeof module;
    const order: string[] = [];
    storage.multiSet([['token', 'x']], (errors) => order.push(`callback ${String(errors)} idle=${tracker.isIdle()}`));
    expect(calls).toEqual([['RNCAsyncStorage', [['token', 'x']]]]);
    vi.advanceTimersByTime(15);
    expect(tracker.describeBusy()).toEqual(['RNCAsyncStorage.multiSet() 15ms']);
    saved!(undefined);
    expect(order).toEqual(['callback undefined idle=true']); // settled before the app's callback runs
    saved!(undefined); // a second call changes nothing
    expect(tracker.isIdle()).toBe(true);

    storage.multiGet(['token'], () => undefined);
    expect(tracker.isIdle()).toBe(true);
    expect(() => storage.multiRemove(['token'], () => undefined)).toThrow('bad key');
    expect(tracker.isIdle()).toBe(true);
  });

  it('describes the calls pending at some point during a wait, relative to its start (#107)', async () => {
    const s = storageModule();
    let callback: (() => void) | undefined;
    const module = { multiSet: (_p: unknown, cb: () => void) => void (callback = cb), requestPermissionsAsync: () => new Promise(() => undefined) };
    const expo = { modules: { Storage: s.module, RNCAsyncStorage: module } as Record<string, unknown> };
    const tracker = setup({ expo });
    tracker.configure({ enabled: true });
    const storage = expo.modules['RNCAsyncStorage'] as typeof module;
    storage.multiSet([], () => undefined);
    callback!(); // settled at 0, before the wait
    vi.advanceTimersByTime(90);
    const p = (expo.modules['Storage'] as typeof s.module).setItem('a'); // 90: before the wait, settles in it
    vi.advanceTimersByTime(10);
    storage.multiSet([], () => undefined); // 100: in the wait
    vi.advanceTimersByTime(5);
    callback!();
    storage.requestPermissionsAsync(); // 105: ignored by default, still pending
    s.pending.resolve();
    await p;
    vi.advanceTimersByTime(15);
    void (expo.modules['Storage'] as typeof s.module).setItem('b'); // 120: after the wait
    expect(tracker.describeActivity(95, 110)).toEqual([
      'Storage.setItem() -5ms→+10ms',
      'RNCAsyncStorage.multiSet() +5ms→+10ms',
      'RNCAsyncStorage.requestPermissionsAsync() +10ms→pending (ignored)',
    ]);
    tracker.configure({ enabled: false });
    expect(tracker.describeActivity(119, 125)).toEqual([
      'RNCAsyncStorage.requestPermissionsAsync() -14ms→pending (not counted: tracker off)',
      'Storage.setItem() +1ms→pending (not counted: tracker off)',
    ]);
  });

  it('a call given callbacks that returns a promise is pending until the promise settles', async () => {
    const pending = deferred();
    const module = { load: (_onProgress: () => void) => pending.promise };
    const expo = { modules: { Loader: module } as Record<string, unknown> };
    const tracker = setup({ expo });
    tracker.configure({ enabled: true });
    const p = (expo.modules['Loader'] as typeof module).load(() => undefined);
    expect(tracker.describeBusy()).toEqual(['Loader.load() 0ms']);
    pending.resolve();
    await p;
    expect(tracker.isIdle()).toBe(true);
  });

  it('a call stops counting after thresholdMs (it waits for the user), and ignored calls never count', () => {
    const s = storageModule();
    const permissions = { requestPermissionsAsync: () => new Promise(() => undefined), getAsync: () => new Promise(() => undefined) };
    const expo = { modules: { Storage: s.module, ExpoLocation: permissions } as Record<string, unknown> };
    const tracker = setup({ expo });
    tracker.configure({ enabled: true, thresholdMs: 2000, ignore: ['ExpoLocation.request', /Storage\.set/] });
    void (expo.modules['ExpoLocation'] as typeof permissions).requestPermissionsAsync();
    void (expo.modules['Storage'] as typeof s.module).setItem('x');
    expect(tracker.isIdle()).toBe(true);
    void (expo.modules['ExpoLocation'] as typeof permissions).getAsync();
    expect(tracker.isIdle()).toBe(false);
    vi.advanceTimersByTime(1999);
    expect(tracker.isIdle()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(tracker.isIdle()).toBe(true);
  });

  it('while off, records calls without counting them and names them (#94); the agent\'s own module is not wrapped', () => {
    const s = storageModule();
    const own = { locate: () => Promise.resolve() };
    const expo = { modules: { Storage: s.module, QuiescoNative: own } as Record<string, unknown> };
    const tracker = setup({ expo });
    tracker.configure({ enabled: false });
    void (expo.modules['Storage'] as typeof s.module).setItem('x');
    vi.advanceTimersByTime(5);
    expect(tracker.isIdle()).toBe(true);
    expect(tracker.notCounted()).toEqual(['Storage.setItem() 5ms']);
    tracker.configure({ enabled: true });
    expect(tracker.isIdle()).toBe(false);
    expect(tracker.notCounted()).toEqual([]);
    expect(expo.modules['QuiescoNative']).toBe(own);
  });

  it('ignores calls that wait for the user by default; the config adds to them or turns them off (#93)', () => {
    const never = () => new Promise(() => undefined);
    const names = [
      'ExpoLocation.requestForegroundPermissionsAsync',
      'ExpoNotificationPermissionsModule.requestPermissionsAsync',
      'PermissionsAndroid.requestPermission',
      'PermissionsAndroid.requestMultiplePermissions',
      'RNCDatePicker.open',
      'RNCTimePicker.open',
      'ExpoLocalAuthentication.authenticateAsync',
      'ShareModule.share',
      'ExpoWebBrowser.openAuthSessionAsync',
      'ExponentImagePicker.launchImageLibraryAsync',
      'AlertManager.alertWithArgs',
      'DialogManagerAndroid.showAlert',
      'ActionSheetManager.showActionSheetWithOptions',
      'NativeAnimatedModule.startAnimatingNode',
      'NativeAnimatedTurboModule.startAnimatingNode',
    ];
    const modules: Record<string, Record<string, () => Promise<unknown>>> = {};
    for (const n of [...names, 'ExpoLocation.getCurrentPositionAsync', 'RNCDatePicker.dismiss']) {
      const [m, f] = n.split('.') as [string, string];
      (modules[m] ??= {})[f] = never;
    }
    const expo = { modules: modules as Record<string, unknown> };
    const tracker = setup({ expo });
    const call = (n: string) => {
      const [m, f] = n.split('.') as [string, string];
      void (expo.modules[m] as Record<string, () => Promise<unknown>>)[f]!();
    };
    tracker.configure({ enabled: true, ignore: ['Storage.'] });
    for (const n of names) call(n);
    expect(tracker.isIdle()).toBe(true);
    call('ExpoLocation.getCurrentPositionAsync');
    call('RNCDatePicker.dismiss');
    expect(tracker.describeBusy()).toEqual(['ExpoLocation.getCurrentPositionAsync() 0ms', 'RNCDatePicker.dismiss() 0ms']);
    tracker.configure({ enabled: true, defaultIgnore: false });
    expect(tracker.describeBusy()).toHaveLength(names.length + 2);
  });

  it('leaves the registry and Expo\'s modules alone when the build does not ask for wrapping (#74)', () => {
    const s = storageModule();
    const get = () => s.module;
    const registry: ModuleRegistryLike = { get, getEnforcing: get };
    const modules = { Storage: s.module };
    const expo = { modules };
    const tracker = setup({ registry, expo }, false);
    expect(tracker.wraps).toBe(false);
    expect(registry.get).toBe(get);
    expect(registry.getEnforcing).toBe(get);
    expect(expo.modules).toBe(modules);
    // a method taken from the module is the module's own function (a worklet can call it on the UI runtime)
    expect(registry.getEnforcing!('Storage')).toBe(s.module);
    tracker.configure({ enabled: true });
    void s.module.setItem('x');
    expect(tracker.isIdle()).toBe(true);
  });

  it('uninstall restores the registry and Expo\'s modules; no sources (the web) is fine', () => {
    const s = storageModule();
    const get = () => s.module;
    const registry: ModuleRegistryLike = { get, getEnforcing: get };
    const modules = { Storage: s.module };
    const expo = { modules };
    const tracker = setup({ registry, expo });
    expect(registry.get).not.toBe(get);
    expect(expo.modules).not.toBe(modules);
    tracker.uninstall();
    expect(registry.get).toBe(get);
    expect(expo.modules).toBe(modules);
    expect(() => setup({}).install()).not.toThrow();
  });

  it('wraps a read-only registry function by redefining it', () => {
    const s = storageModule();
    const registry = {} as ModuleRegistryLike;
    Object.defineProperty(registry, 'get', { value: () => s.module, writable: false, configurable: true, enumerable: true });
    const tracker = setup({ registry });
    tracker.configure({ enabled: true });
    void (registry.get!('Storage') as typeof s.module).setItem('x');
    expect(tracker.isIdle()).toBe(false);
  });
});
