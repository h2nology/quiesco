/**
 * App entry wrapper (requirements.md §6.7). Restricts queries to its subtree, connects to the host,
 * and owns the key used to remount the whole app on soft reset.
 * Trackers are installed earlier, at import time: children's effects run before this component's
 * effects, so installing here would miss requests the app starts on mount.
 */
import type { ReactNode } from 'react';
import { Fragment, useEffect, useState } from 'react';

import { navigationRefHook } from '../navigation/expo-router';
import { getRuntime } from '../singleton';

export interface QuiescoRootProps {
  children?: ReactNode;
}

export function QuiescoRoot({ children }: QuiescoRootProps): ReactNode {
  const runtime = getRuntime();
  const [rootKey, setRootKey] = useState(0);
  // Expo Router's container ref (null without Expo Router); the same hook on every render.
  const navigationRef = navigationRefHook()();
  useEffect(() => {
    const offRemount = runtime.setRemount(() => setRootKey((k) => k + 1));
    runtime.mount(QuiescoRoot);
    return () => {
      offRemount();
      runtime.unmount();
    };
  }, [runtime]);
  // Passive effect: the container's ref is attached (layout phase) and holds its initial state by now.
  useEffect(() => runtime.navigation.setRef(navigationRef), [runtime, navigationRef]);
  return <Fragment key={rootKey}>{children}</Fragment>;
}
