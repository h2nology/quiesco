// Keep this import first: it installs the DevTools hook, the scheduler patch and the trackers.
import './install';

export { QuiescoRoot } from './root/QuiescoRoot';
export type { QuiescoRootProps } from './root/QuiescoRoot';
export { quiesco } from './api';
export type { Backdoor, Backdoors, QuiescoApi, StorageAdapter } from './api-types';
export type { JsonCompatible } from '@quiesco/protocol';
