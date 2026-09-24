import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
// Checks for the modern publishable key first, falls back to legacy anon key
const supabaseKey = 
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

console.log('DEBUG ENV:', {
  url: supabaseUrl,
  hasKey: Boolean(supabaseKey),
});

export const supabase = createClient(supabaseUrl, supabaseKey);