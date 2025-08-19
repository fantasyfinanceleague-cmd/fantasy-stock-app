// src/supabase/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://haiaaifjcclsvmkfqgmd.supabase.co'; // Replace with your real URL
const supabaseKey = 'REDACTED'; // Replace with your anon key

export const supabase = createClient(supabaseUrl, supabaseKey);
