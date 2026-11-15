/**
 * A date field on the web: @react-native-community/datetimepicker has no web implementation, so the
 * browser's own `<input type="date">` (react-dom element, rendered inside the react-native-web tree).
 */
import { createElement } from 'react';

import type { DateFieldProps } from './DateField';

const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTime = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Like the native pickers: a date input changes the day, a time input the hours and minutes. */
export function DateField({ testID, value, onChange, mode = 'date' }: DateFieldProps) {
  return createElement('input', {
    type: mode,
    'data-testid': testID,
    value: mode === 'time' ? toTime(value) : toIso(value),
    onChange: (e: { target: { value: string } }) => {
      const parts = e.target.value.split(mode === 'time' ? ':' : '-').map(Number);
      if (e.target.value === '' || parts.some((n) => Number.isNaN(n))) return;
      const next = new Date(value);
      if (mode === 'time') next.setHours(parts[0] as number, parts[1] as number, 0, 0);
      else next.setFullYear(parts[0] as number, (parts[1] as number) - 1, parts[2] as number);
      onChange(next);
    },
    style: { fontSize: 16, padding: 6 },
  });
}
