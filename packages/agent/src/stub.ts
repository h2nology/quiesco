/**
 * Production stub: withQuiesco() (metro.cjs) resolves `@quiesco/agent` to this file in non-e2e builds
 * (docs/spikes/06-prod-strip.md). It must export the same API as index.ts and pull in nothing else.
 */
import type { ReactNode } from 'react';

import type { QuiescoApi } from './api-types';

export type { Backdoor, QuiescoApi, StorageAdapter } from './api-types';

export interface QuiescoRootProps {
  children?: ReactNode;
}

export function QuiescoRoot({ children }: QuiescoRootProps): ReactNode {
  return children ?? null;
}

const noop = (): void => {};

/** No-ops in production: registrations are accepted and ignored. */
export const quiesco: QuiescoApi = {
  backdoor: () => noop,
  onReset: () => noop,
  registerStorage: () => noop,
};
