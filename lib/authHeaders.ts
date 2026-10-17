import { supabase } from './supabase';

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    throw new Error('ログインが必要です');
  }
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  return {
    apikey: anonKey,
    Authorization: `Bearer ${data.session.access_token}`,
  };
}
