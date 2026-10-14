// Onboarding W2 — the one dynamic piece of the app config. Everything else stays in app.json,
// which Expo passes in here as `config`.
//
// Sign in with Google needs the iOS OAuth client's REVERSED client ID registered as a URL scheme
// (com.googleusercontent.apps.<id>), or the Google SDK throws when the sheet opens. The
// @react-native-google-signin config plugin writes it, but it refuses to run without a value. So
// the scheme is derived from the same public client ID the JS reads
// (EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID; set per build profile in eas.json / EAS env), and the plugin
// is added ONLY when that ID is set. A build without it gets no scheme and no Google button
// (lib/auth/socialSignIn.ts), never a button that crashes. The ID is not a secret.

const GOOGLE_PLUGIN = '@react-native-google-signin/google-signin';
const CLIENT_SUFFIX = '.apps.googleusercontent.com';

/** "123-abc.apps.googleusercontent.com" → "com.googleusercontent.apps.123-abc"; null if malformed. */
function googleIosUrlScheme(clientId) {
  if (typeof clientId !== 'string') return null;
  const id = clientId.trim();
  if (!id.endsWith(CLIENT_SUFFIX)) return null;
  const prefix = id.slice(0, -CLIENT_SUFFIX.length);
  if (!/^[0-9]+-[a-z0-9]+$/.test(prefix)) return null;
  return `com.googleusercontent.apps.${prefix}`;
}

function withGoogleSignIn(config, clientId) {
  const plugins = (config.plugins || []).filter((p) => (Array.isArray(p) ? p[0] : p) !== GOOGLE_PLUGIN);
  const iosUrlScheme = googleIosUrlScheme(clientId);
  if (!iosUrlScheme) {
    if (clientId) throw new Error(`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID is not an iOS OAuth client ID: "${clientId}"`);
    return { ...config, plugins };
  }
  return { ...config, plugins: [...plugins, [GOOGLE_PLUGIN, { iosUrlScheme }]] };
}

module.exports = ({ config }) => withGoogleSignIn(config, process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID);
module.exports.googleIosUrlScheme = googleIosUrlScheme;
module.exports.withGoogleSignIn = withGoogleSignIn;
