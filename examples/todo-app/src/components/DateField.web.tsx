/**
 * A date field on the web: @react-native-community/datetimepicker has no web implementation, so the
 * browser's own `<input type="date">` (react-dom element, rendered inside the react-native-web tree).
 */
import { createElement } from 'react';

import type { DateFieldProps } from './DateField';

function toIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function DateField({ testID, value, onChange }: DateFieldProps) {
  return createElement('input', {
    type: 'date',
    'data-testid': testID,
    value: toIso(value),
    onChange: (e: { target: { value: string } }) => {
      const [y, m, d] = e.target.value.split('-').map(Number);
      if (y !== undefined && m !== undefined && d !== undefined && e.target.value !== '') onChange(new Date(y, m - 1, d));
    },
    style: { fontSize: 16, padding: 6 },
  });
}
