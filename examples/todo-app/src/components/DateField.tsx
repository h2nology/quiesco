/**
 * A date field on iOS / Android (DateField.web.tsx on the web):
 * - iOS: an always-visible wheel picker (`display="spinner"`), driven by real wheel scrolling in native mode.
 * - Android: a button that opens the system date dialog; the picker component renders nothing itself
 *   (it opens the dialog imperatively), so tests set its value through its `onChange`.
 */
import DateTimePicker from '@react-native-community/datetimepicker';
import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text } from 'react-native';

export interface DateFieldProps {
  testID: string;
  value: Date;
  onChange: (date: Date) => void;
}

export function DateField({ testID, value, onChange }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const handle = (event: DateTimePickerEvent, date?: Date) => {
    setOpen(false);
    if (event.type === 'set' && date !== undefined) onChange(date);
  };
  if (Platform.OS === 'ios') {
    return <DateTimePicker testID={testID} value={value} mode="date" display="spinner" onChange={handle} style={styles.wheels} />;
  }
  return (
    <>
      <Pressable testID={`${testID}-open`} accessibilityRole="button" style={styles.button} onPress={() => setOpen(true)}>
        <Text>选择日期</Text>
      </Pressable>
      {open && <DateTimePicker testID={testID} value={value} mode="date" onChange={handle} />}
    </>
  );
}

const styles = StyleSheet.create({
  wheels: { height: 160, alignSelf: 'stretch' },
  button: { paddingVertical: 8, paddingHorizontal: 16, backgroundColor: '#e5e7eb', borderRadius: 6 },
});
