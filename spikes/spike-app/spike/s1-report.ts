/* eslint-disable @typescript-eslint/no-explicit-any */
import { Dimensions, PixelRatio, Platform } from 'react-native';

import { spikeState } from './devtools-hook';
import { findByTestIDUnified, findHostByTestID, hostSummary } from './fiber-query';
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
    if (ms.length === 0) lines.push(`[S1] testID=${id} NOT FOUND (host-props lookup)`);
    for (const m of findByTestIDUnified(id)) {
      const meas = measureFiber(m.fiber);
      const dom = (m.fiber.stateNode as any)?.getAttribute?.('data-testid');
      lines.push(`[S1-unified] testID=${id} type=${m.type} text=${JSON.stringify(m.text)} role=${m.role} domTestId=${dom ?? '-'} hostPropsKeys=${Object.keys(m.fiber.memoizedProps ?? {}).slice(0, 8).join(',')} rect=${JSON.stringify(meas.rect)}`);
    }
  }
  lines.push(`[S1] hostCount=${hostSummary().length}`);
  console.log(lines.join('\n'));
}
