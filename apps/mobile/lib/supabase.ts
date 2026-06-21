import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
// Phase 3a: legacy anon key -> new publishable key (anon drop-in replacement).
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

// Only import AsyncStorage in native environments (not during static rendering)
let storage: any = undefined;
if (Platform.OS !== 'web' && typeof window !== 'undefined') {
  // Dynamic import to avoid issues during static rendering
  storage = require('@react-native-async-storage/async-storage').default;
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: storage,
    autoRefreshToken: true,
    persistSession: Platform.OS !== 'web' && typeof window !== 'undefined',
    detectSessionInUrl: false,
    storageKey: 'fantasy-finance-auth',
  },
});
