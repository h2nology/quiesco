/**
 * The notification permission on the iOS simulator (issue #113). `simctl privacy` has no notifications
 * service; the per-app setting is a `BBSectionInfo` (NSKeyedArchiver data) keyed by bundle id in
 * `<simulator data>/Library/BulletinBoard/VersionedSectionInfo.plist`. SpringBoard reads that file when
 * it starts, so a change takes effect after restarting SpringBoard, which also ends the running apps
 * (checked on iOS 27). `simctl uninstall` removes the app's entry; `simctl install` keeps it.
 *
 * The settings object carries `authorizationStatus` (UNAuthorizationStatus: 0 not determined, 1 denied,
 * 2 authorized, 3 provisional, 4 ephemeral), as iOS 27 writes it after the user answers the prompt;
 * entries written by older tools (applesimutils) carry `allowsNotifications` instead.
 */
import type { PlistDict, PlistValue } from './bplist.js';
import { PlistUid, isPlistDict, parseBplist, plistDict, writeBplist } from './bplist.js';

/** Relative to the simulator's data directory. */
export const IOS_NOTIFICATION_SETTINGS_FILE = 'Library/BulletinBoard/VersionedSectionInfo.plist';

/** `unset`: no answer yet, the app's request shows the prompt (as after a fresh install). */
export type NotificationAuthorization = 'allowed' | 'denied' | 'unset';

const AUTHORIZED = 2;
const DENIED = 1;

/** What the user would have chosen with "Allow": banners, Notification Center, lock screen. */
const ALLOWED_SETTINGS: Readonly<Record<string, PlistValue>> = {
  authorizationStatus: AUTHORIZED,
  alertType: 1,
  lockScreenSetting: 2,
  notificationCenterSetting: 2,
  showsInLockScreen: true,
  showsInNotificationCenter: true,
  pushSettings: 63,
};

function sectionInfo(file: PlistDict): PlistDict {
  const s = file.sectionInfo;
  if (!isPlistDict(s)) throw new Error('no sectionInfo dictionary');
  return s;
}

/** The archived `BBSectionInfoSettings` of a section archive (and the archive), or null when its shape is unknown. */
function settingsOf(archive: PlistValue): { archive: PlistDict; settings: PlistDict } | null {
  if (!isPlistDict(archive)) return null;
  const objects = archive.$objects;
  const top = archive.$top;
  if (!Array.isArray(objects) || !isPlistDict(top) || !(top.root instanceof PlistUid)) return null;
  const root = objects[top.root.value];
  if (!isPlistDict(root) || !(root.sectionInfoSettings instanceof PlistUid)) return null;
  const settings = objects[root.sectionInfoSettings.value];
  return isPlistDict(settings) ? { archive, settings } : null;
}

function authorizationOf(settings: PlistDict): NotificationAuthorization {
  const status = settings.authorizationStatus;
  if (typeof status === 'number') return status === AUTHORIZED ? 'allowed' : status === DENIED ? 'denied' : 'unset';
  const allows = settings.allowsNotifications;
  if (typeof allows === 'boolean') return allows ? 'allowed' : 'denied';
  return 'unset';
}

/** The app's notification permission recorded in `VersionedSectionInfo.plist` (its contents). */
export function notificationAuthorization(file: Buffer, bundleId: string): NotificationAuthorization {
  const entry = sectionInfo(parseBplist(file) as PlistDict)[bundleId];
  if (!Buffer.isBuffer(entry)) return 'unset';
  const s = settingsOf(parseBplist(entry));
  return s === null ? 'unset' : authorizationOf(s.settings);
}

/** A new section for `bundleId`, shaped as SpringBoard archives one. */
function newSection(bundleId: string, settings: PlistDict): PlistDict {
  const objects: PlistValue[] = [
    '$null',
    plistDict({
      $class: new PlistUid(6),
      sectionID: new PlistUid(2),
      sectionInfoSettings: new PlistUid(3),
      sectionType: 0,
      sectionCategory: 0,
      suppressFromSettings: false,
      version: new PlistUid(5),
    }),
    bundleId,
    plistDict({ $class: new PlistUid(4), ...settings }),
    plistDict({ $classes: ['BBSectionInfoSettings', 'NSObject'], $classname: 'BBSectionInfoSettings' }),
    0,
    plistDict({ $classes: ['BBSectionInfo', 'NSObject'], $classname: 'BBSectionInfo' }),
  ];
  return plistDict({ $archiver: 'NSKeyedArchiver', $objects: objects, $top: plistDict({ root: new PlistUid(1) }), $version: 100000 });
}

/**
 * `VersionedSectionInfo.plist` (its contents) with the app's notification permission set to `want`, or
 * null when it already is. `unset` removes the app's entry, as uninstalling does. An existing entry keeps
 * its other settings.
 */
export function withNotificationAuthorization(file: Buffer, bundleId: string, want: NotificationAuthorization): Buffer | null {
  const plist = parseBplist(file) as PlistDict;
  const sections = sectionInfo(plist);
  const entry = sections[bundleId];
  const existing = Buffer.isBuffer(entry) ? settingsOf(parseBplist(entry)) : null;
  const current = existing === null ? 'unset' : authorizationOf(existing.settings);
  if (current === want && (want !== 'unset' || entry === undefined)) return null;

  if (want === 'unset') {
    delete sections[bundleId];
    return writeBplist(plist);
  }
  const values: Record<string, PlistValue> = want === 'allowed' ? { ...ALLOWED_SETTINGS } : { authorizationStatus: DENIED };
  if (existing === null) {
    sections[bundleId] = writeBplist(newSection(bundleId, plistDict(values)));
  } else {
    Object.assign(existing.settings, values);
    if ('allowsNotifications' in existing.settings) existing.settings.allowsNotifications = want === 'allowed';
    sections[bundleId] = writeBplist(existing.archive);
  }
  return writeBplist(plist);
}
