import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// Only import AsyncStorage in native environments (not during static rendering)
let storage: any = undefined;
if (Platform.OS !== 'web' && typeof window !== 'undefined') {
  // Dynamic import to avoid issues during static rendering
  storage = require('@react-native-async-storage/async-storage').default;
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: storage,
    autoRefreshToken: true,
    persistSession: Platform.OS !== 'web' && typeof window !== 'undefined',
    detectSessionInUrl: false,
    storageKey: 'fantasy-finance-auth',
  },
});
