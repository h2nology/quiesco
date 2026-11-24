/** Quiesco's platform-neutral permission names (requirements.md §6.9); each provider maps them. */
export const Permission = {
  camera: 'camera',
  microphone: 'microphone',
  location: 'location',
  notifications: 'notifications',
  contacts: 'contacts',
  photos: 'photos',
  calendar: 'calendar',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

/** The second argument of `app.device.setPermission`. */
export const PermissionState = { grant: 'grant', revoke: 'revoke', reset: 'reset' } as const;
export type PermissionState = (typeof PermissionState)[keyof typeof PermissionState];
