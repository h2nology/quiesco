/**
 * App entry wrapper (requirements.md §6.7). Restricts queries to its subtree, connects to the host,
 * and owns the key used to remount the whole app on soft reset.
 * Trackers are installed earlier, at import time: children's effects run before this component's
 * effects, so installing here would miss requests the app starts on mount.
 */
import type { ReactNode } from 'react';
import { Fragment, useEffect, useState } from 'react';

import { getRuntime } from '../singleton';

export interface QuiescoRootProps {
  children?: ReactNode;
}

export function QuiescoRoot({ children }: QuiescoRootProps): ReactNode {
  const runtime = getRuntime();
  const [rootKey, setRootKey] = useState(0);
  useEffect(() => {
    const offRemount = runtime.setRemount(() => setRootKey((k) => k + 1));
    runtime.mount(QuiescoRoot);
    return () => {
      offRemount();
      runtime.unmount();
    };
  }, [runtime]);
  return <Fragment key={rootKey}>{children}</Fragment>;
}
