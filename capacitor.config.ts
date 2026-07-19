import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.wvvy.app',
  appName: 'WVVY',
  webDir: 'build',
  // Dark chrome everywhere so the native shell matches the app's ink background
  // instead of flashing white on launch.
  backgroundColor: '#0a0908',
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      backgroundColor: '#0a0908'
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0a0908'
    }
  },
  ios: {
    contentInset: 'never',
    backgroundColor: '#0a0908'
  },
  android: {
    backgroundColor: '#0a0908'
  }
  // For on-device HMR, run `npm run dev:host` and uncomment the block below with
  // your workstation IP (`ipconfig getifaddr en0`). Android emulators can use
  // http://10.0.2.2:5001. Remove it again before any production build.
  //
  // server: {
  //   url: 'http://192.168.1.100:5001',
  //   cleartext: true
  // }
};

export default config;
