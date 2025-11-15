import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{'Content-Type':'application/json',...cors}});
Deno.serve(async (req)=>{
  if (req.method==='OPTIONS') return new Response('ok',{headers:cors});
  const { q, limit=10 } = await req.json().catch(()=>({}));
  const query = String(q||'').trim();
  if (!query) return json({items:[]});
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { data, error } = await supabase
    .from('symbols')
    .select('symbol,name')
    .or(`symbol.ilike.%${query}%,name.ilike.%${query}%`)
    .order('symbol')
    .limit(Math.min(25, Number(limit)||10));
  if (error) return json({items:[], error:error.message},500);
  return json({items:data||[]});
});
