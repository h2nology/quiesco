/**
 * The app's backdoors by name (issue #6), shared by the app (src/e2e.ts registers them) and the tests
 * (`this.app.backdoor(...)`): one declaration checks the name, the arguments and the result on both sides.
 * A type-only module: nothing of it reaches the bundle.
 */
export type LocationPermission = 'granted' | 'denied' | 'prompt' | null;

declare module '@quiesco/agent' {
  interface Backdoors {
    loginAs: (email: string) => Promise<void>;
    seedTodos: (titles: string[]) => Promise<void>;
    /** 'granted' / 'denied' / 'prompt', or null where the app cannot tell (iOS). */
    locationPermission: () => Promise<LocationPermission>;
    openPlayground: () => void;
    openGestures: () => void;
    openControls: () => void;
    openLifecycle: () => void;
    openDevice: () => void;
    openSystem: () => void;
    openWebView: () => void;
    openShowcase: () => void;
  }
}
