import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{'Content-Type':'application/json',...cors}});
Deno.serve(async (req)=>{
  if (req.method==='OPTIONS') return new Response('ok',{headers:cors});
  const { symbol } = await req.json().catch(()=>({}));
  const sym = String(symbol||'').toUpperCase();
  if (!sym) return json({error:'symbol required'},400);
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { data, error } = await supabase.from('symbols').select('name').eq('symbol', sym).maybeSingle();
  if (error) return json({error:error.message},500);
  return json({ok: !!data, symbol: sym, name: data?.name ?? null});
});
