// Must stay the first import: Quiesco's agent hooks into React before the app loads.
// In builds without EXPO_PUBLIC_QUIESCO=1, metro.config.js swaps it for a no-op stub.
import '@quiesco/agent';
import 'expo-router/entry';
