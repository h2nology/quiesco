/* eslint-disable @typescript-eslint/no-explicit-any */
import { Dimensions, PixelRatio, Platform } from 'react-native';

import { spikeState } from './devtools-hook';
import { findHostByTestID, hostSummary } from './fiber-query';
import { measureFiber } from './measure';

export function runS1Report(): void {
  const ids = ['pressable-button', 'rngh-button', 'pressable-count', 'native-ping'];
  const lines: string[] = [];
  lines.push(`[S1] platform=${Platform.OS} hookSource=${spikeState.hookSource}`);
  spikeState.renderers.forEach((r, id) =>
    lines.push(`[S1] renderer#${id} pkg=${r.rendererPackageName} version=${r.version} bundleType=${r.bundleType}`),
  );
  lines.push(`[S1] window=${JSON.stringify(Dimensions.get('window'))} pixelRatio=${PixelRatio.get()}`);
  for (const id of ids) {
    const ms = findHostByTestID(id);
    for (const m of ms) {
      const meas = measureFiber(m.fiber);
      lines.push(`[S1] testID=${id} type=${m.type} text=${JSON.stringify(m.text)} role=${m.role} measure=${JSON.stringify(meas)}`);
    }
    if (ms.length === 0) lines.push(`[S1] testID=${id} NOT FOUND`);
  }
  lines.push(`[S1] hostCount=${hostSummary().length}`);
  console.log(lines.join('\n'));
}
