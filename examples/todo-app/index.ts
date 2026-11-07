// Must stay the first import: installs Quiesco's React hook, scheduler patch and idle trackers before
// React Native's renderer loads. In non-e2e builds metro.config.js swaps it for a no-op stub.
import '@quiesco/agent';
import 'expo-router/entry';
