/**
 * `@quiesco/cucumber/events`: a cucumber-js formatter plugin that sends run events to `quiesco test` /
 * `quiesco ui` (progress bar, test UI). The CLI adds it as
 *
 *   --format "file:///…/events-formatter.js":"/dev/null"
 *
 * The file target matters: a format without one would replace the user's stdout formatter. Without
 * QUIESCO_EVENTS in the environment it sends nothing. It writes nothing to its own stream.
 */
import { connectRunEvents } from '@quiesco/core';

import { CucumberRunEvents } from './run-events.js';
import type { EnvelopeLike } from './run-events.js';

interface FormatterContext {
  on: (key: 'message', handler: (envelope: EnvelopeLike) => void) => void;
}

const formatter = {
  type: 'formatter' as const,
  optionsKey: 'quiesco',
  formatter({ on }: FormatterContext): () => Promise<void> {
    const client = connectRunEvents({ runner: 'cucumber' });
    if (!client.enabled) return () => Promise.resolve();
    const events = new CucumberRunEvents();
    on('message', (envelope) => {
      for (const event of events.push(envelope)) client.send(event);
    });
    return () => client.close();
  },
};

export default formatter;
