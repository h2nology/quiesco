/** S2 spike: scenarios that exercise different kinds of React work. Triggered from s2-run.ts. */
import { Activity, Suspense, use, useDeferredValue, useEffect, useState, startTransition } from 'react';
import { Text, View } from 'react-native';

type Trigger = (name: string) => void;
export const s2Control: { trigger?: Trigger } = {};

function Slow({ n }: { n: number }) {
  // deliberately slow render (~ms per item) to make concurrent work observable
  const start = Date.now();
  while (Date.now() - start < 2) {
    // busy wait
  }
  return <Text>{n}</Text>;
}

function SuspenseChild({ promise }: { promise: Promise<string> }) {
  const v = use(promise);
  return <Text testID="s2-suspense">suspense:{v}</Text>;
}

export function S2Lab() {
  const [basic, setBasic] = useState('init');
  const [chain, setChain] = useState(0);
  const [items, setItems] = useState(0);
  const [promise, setPromise] = useState<Promise<string> | null>(null);
  const [deferredSrc, setDeferredSrc] = useState(0);
  const deferred = useDeferredValue(deferredSrc);
  const [act, setAct] = useState(false);

  // effect chain: each commit schedules another update until 5
  useEffect(() => {
    if (chain > 0 && chain < 5) setChain(chain + 1);
  }, [chain]);

  useEffect(() => {
    s2Control.trigger = (name) => {
      switch (name) {
        case 'basic':
          setBasic('done');
          break;
        case 'chain':
          setChain(1);
          break;
        case 'transition':
          startTransition(() => setItems(150));
          break;
        case 'suspense':
          setPromise(new Promise((r) => setTimeout(() => r('loaded'), 300)));
          break;
        case 'deferred':
          setDeferredSrc(100);
          break;
        case 'suspense2':
          setPromise(new Promise((r) => setTimeout(() => r('again'), 300)));
          break;
        case 'activity':
          setAct(true);
          break;
      }
    };
  }, []);

  return (
    <View style={{ height: 1, overflow: 'hidden' }}>
      <Text testID="s2-basic">basic:{basic}</Text>
      <Text testID="s2-chain">chain:{chain}</Text>
      <Text testID="s2-transition">items:{items}</Text>
      <View>{Array.from({ length: items }, (_, i) => <Slow key={i} n={i} />)}</View>
      {promise && (
        <Suspense fallback={<Text testID="s2-suspense">suspense:fallback</Text>}>
          <SuspenseChild promise={promise} />
        </Suspense>
      )}
      <Text testID="s2-deferred">deferred:{deferred}</Text>
      <View>{Array.from({ length: deferred }, (_, i) => <Slow key={i} n={i} />)}</View>
      <Text testID="s2-activity">activity:{act ? 'on' : 'off'}</Text>
      {act && (
        <Activity mode="hidden">
          <View>{Array.from({ length: 80 }, (_, i) => <Slow key={i} n={i} />)}</View>
        </Activity>
      )}
    </View>
  );
}
