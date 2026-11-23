import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PlistReal, PlistUid, parseBplist, plistDict, writeBplist } from '../src/devices/bplist';
import type { PlistDict, PlistValue } from '../src/devices/bplist';
import type { Exec } from '../src/devices/exec';
import { IosProvider } from '../src/devices/ios';
import { IOS_NOTIFICATION_SETTINGS_FILE, notificationAuthorization, withNotificationAuthorization } from '../src/devices/ios-notifications';

const BUNDLE = 'com.example.todo';

/** A section archive shaped as iOS 27 writes it after the user answered the prompt. */
function section(bundleId: string, settings: Record<string, PlistValue>): Buffer {
  return writeBplist(
    plistDict({
      $archiver: 'NSKeyedArchiver',
      $objects: [
        '$null',
        plistDict({ $class: new PlistUid(5), appName: new PlistUid(4), sectionID: new PlistUid(2), sectionInfoSettings: new PlistUid(3), sectionType: 0 }),
        bundleId,
        plistDict({ $class: new PlistUid(6), ...settings }),
        'Todo',
        plistDict({ $classes: ['BBSectionInfo', 'NSObject'], $classname: 'BBSectionInfo' }),
        plistDict({ $classes: ['BBSectionInfoSettings', 'NSObject'], $classname: 'BBSectionInfoSettings' }),
      ],
      $top: plistDict({ root: new PlistUid(1) }),
      $version: 100000,
    }),
  );
}

function settingsFile(sections: Record<string, Buffer>): Buffer {
  return writeBplist(plistDict({ sectionInfo: plistDict(sections), sectionInfoVersionNumber: 3 }));
}

/** The settings object of `bundleId`'s section in a settings file. */
function settingsIn(file: Buffer, bundleId: string): PlistDict | undefined {
  const entry = ((parseBplist(file) as PlistDict).sectionInfo as PlistDict)[bundleId];
  if (!Buffer.isBuffer(entry)) return undefined;
  const archive = parseBplist(entry) as PlistDict;
  const objects = archive.$objects as PlistValue[];
  const root = objects[((archive.$top as PlistDict).root as PlistUid).value] as PlistDict;
  return objects[(root.sectionInfoSettings as PlistUid).value] as PlistDict;
}

describe('binary property lists', () => {
  it('round-trips every value type, long strings and non-ASCII text', () => {
    const value = plistDict({
      nothing: null,
      yes: true,
      no: false,
      small: 7,
      wide: 70_000,
      negative: -3,
      big: 2 ** 40,
      real: new PlistReal(1),
      date: new Date('2026-11-23T00:00:00Z'),
      data: Buffer.from([0, 1, 2, 255]),
      ascii: 'x'.repeat(300),
      text: '“rnshootout” Would Like to Send You Notifications 通知',
      uid: new PlistUid(300),
      list: [1, 'two', [plistDict({ nested: true })]],
      ['__proto__']: 'a plain key',
    });
    const back = parseBplist(writeBplist(value));
    expect(back).toEqual(value);
    expect((back as PlistDict).real).toBeInstanceOf(PlistReal);
    expect(Object.keys(back as PlistDict)).toContain('__proto__');
  });

  it('refuses what is not a binary property list', () => {
    expect(() => parseBplist(Buffer.from('<?xml version="1.0"?><plist/>'.padEnd(64)))).toThrow(/not a binary property list/);
  });
});

describe('notification settings (VersionedSectionInfo.plist)', () => {
  const allowed = section(BUNDLE, { authorizationStatus: 2, alertType: 1, showsInNotificationCenter: true, summarizationSetting: 2 });

  it('reads iOS 27 entries, entries written by applesimutils, and missing ones', () => {
    expect(notificationAuthorization(settingsFile({ [BUNDLE]: allowed }), BUNDLE)).toBe('allowed');
    expect(notificationAuthorization(settingsFile({ [BUNDLE]: section(BUNDLE, { authorizationStatus: 1 }) }), BUNDLE)).toBe('denied');
    expect(notificationAuthorization(settingsFile({ [BUNDLE]: section(BUNDLE, { authorizationStatus: 0 }) }), BUNDLE)).toBe('unset');
    expect(notificationAuthorization(settingsFile({ [BUNDLE]: section(BUNDLE, { allowsNotifications: true }) }), BUNDLE)).toBe('allowed');
    expect(notificationAuthorization(settingsFile({ [BUNDLE]: section(BUNDLE, { allowsNotifications: false }) }), BUNDLE)).toBe('denied');
    expect(notificationAuthorization(settingsFile({ other: allowed }), BUNDLE)).toBe('unset');
  });

  it('changes nothing when the app already has the wanted setting', () => {
    expect(withNotificationAuthorization(settingsFile({ [BUNDLE]: allowed }), BUNDLE, 'allowed')).toBeNull();
    expect(withNotificationAuthorization(settingsFile({}), BUNDLE, 'unset')).toBeNull();
  });

  it('adds an allowed entry for a new app and keeps the other apps', () => {
    const other = section('com.example.other', { authorizationStatus: 1 });
    const next = withNotificationAuthorization(settingsFile({ 'com.example.other': other }), BUNDLE, 'allowed') as Buffer;
    expect(notificationAuthorization(next, BUNDLE)).toBe('allowed');
    expect(settingsIn(next, BUNDLE)).toMatchObject({ authorizationStatus: 2, alertType: 1, showsInNotificationCenter: true, showsInLockScreen: true });
    expect(((parseBplist(next) as PlistDict).sectionInfo as PlistDict)['com.example.other']).toEqual(other);
    expect((parseBplist(next) as PlistDict).sectionInfoVersionNumber).toBe(3);
  });

  it('denies and allows an existing entry, keeping its other settings', () => {
    const denied = withNotificationAuthorization(settingsFile({ [BUNDLE]: allowed }), BUNDLE, 'denied') as Buffer;
    expect(settingsIn(denied, BUNDLE)).toMatchObject({ authorizationStatus: 1, summarizationSetting: 2 });
    const legacy = section(BUNDLE, { allowsNotifications: false, alertType: 0 });
    const regranted = withNotificationAuthorization(settingsFile({ [BUNDLE]: legacy }), BUNDLE, 'allowed') as Buffer;
    expect(settingsIn(regranted, BUNDLE)).toMatchObject({ authorizationStatus: 2, allowsNotifications: true, alertType: 1 });
  });

  it('unset removes the entry, as uninstalling does', () => {
    const next = withNotificationAuthorization(settingsFile({ [BUNDLE]: allowed }), BUNDLE, 'unset') as Buffer;
    expect(settingsIn(next, BUNDLE)).toBeUndefined();
  });
});

describe('IosProvider: the notification permission (issue #113)', () => {
  let data: string;
  let file: string;
  let calls: string[];
  let springBoard: number;
  let xml: Buffer | null;

  beforeEach(() => {
    data = fs.mkdtempSync(path.join(os.tmpdir(), 'quiesco-sim-'));
    file = path.join(data, IOS_NOTIFICATION_SETTINGS_FILE);
    calls = [];
    springBoard = 100;
    xml = null;
  });
  afterEach(() => fs.rmSync(data, { recursive: true, force: true }));

  const exec: Exec = async (cmd, args) => {
    const line = `${cmd} ${args.join(' ')}`;
    calls.push(line);
    const out = (s: string | Buffer) => ({ stdout: Buffer.isBuffer(s) ? s : Buffer.from(s), stderr: '' });
    if (line.includes('list devices available --json')) {
      return out(JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [{ udid: 'SIM', name: 'iPhone 17', state: 'Booted', dataPath: data }] } }));
    }
    if (line.endsWith('launchctl list')) return out(`PID\tStatus\tLabel\n${springBoard}\t-9\tcom.apple.SpringBoard\n42\t0\tcom.apple.backboardd\n`);
    if (line.endsWith('launchctl stop com.apple.SpringBoard')) springBoard++;
    if (cmd === 'plutil' && args[0] === '-convert' && xml !== null) return out(xml);
    return out('');
  };

  async function booted() {
    const p = new IosProvider({ app: { bundleId: BUNDLE }, device: { disablePasswordAutoFill: false }, exec });
    await p.boot();
    calls.length = 0;
    return p;
  }
  const restarts = () => calls.filter((c) => c.endsWith('launchctl stop com.apple.SpringBoard')).length;

  it('grantPermissions writes an allowed entry and restarts SpringBoard, once', async () => {
    const p = await booted();
    await p.grantPermissions(['notifications']);
    expect(notificationAuthorization(fs.readFileSync(file), BUNDLE)).toBe('allowed');
    expect(calls).toContain('xcrun simctl spawn SIM launchctl stop com.apple.SpringBoard');
    expect(restarts()).toBe(1);

    await p.grantPermissions(['notifications']);
    expect(restarts()).toBe(1);
  });

  it('setPermission / resetPermission relaunch the app only when the setting changed', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, settingsFile({ [BUNDLE]: section(BUNDLE, { authorizationStatus: 2 }) }));
    const p = await booted();
    await expect(p.setPermission('notifications', true)).resolves.toEqual({ relaunch: false });
    expect(restarts()).toBe(0);
    await expect(p.setPermission('notifications', false)).resolves.toEqual({ relaunch: true });
    expect(notificationAuthorization(fs.readFileSync(file), BUNDLE)).toBe('denied');
    await expect(p.resetPermission('notifications')).resolves.toEqual({ relaunch: true });
    expect(settingsIn(fs.readFileSync(file), BUNDLE)).toBeUndefined();
    await expect(p.resetPermission('notifications')).resolves.toEqual({ relaunch: false });
    expect(restarts()).toBe(2);
  });

  it('reads the XML file SpringBoard writes through plutil', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict/></plist>\n');
    xml = settingsFile({ [BUNDLE]: section(BUNDLE, { authorizationStatus: 2 }) });
    const p = await booted();
    await expect(p.setPermission('notifications', true)).resolves.toEqual({ relaunch: false });
    expect(calls).toEqual([`plutil -convert binary1 -o - ${file}`]);
  });
});
