/**
 * Build-time fallback connection parameters. `withQuiesco()` (metro.cjs) replaces this module with a
 * generated one in e2e builds (docs/spikes/00-summary.md agent §6: in JS-only mode there are no
 * launch parameters, and `EXPO_PUBLIC_*` is not inlined inside node_modules).
 */
export const buildConfig: { port: number | null; session: string | null } = { port: null, session: null };
