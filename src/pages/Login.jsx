import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase/supabaseClient';

export default function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function signIn(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
    setBusy(false);
    if (error) setErr(error.message);
    else nav('/', { replace: true });
  }

  async function signUp(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    const { error } = await supabase.auth.signUp({ email, password: pw });
    setBusy(false);
    if (error) setErr(error.message);
    else nav('/', { replace: true });
  }

  return (
    <div className="page">
      <div className="card" style={{ maxWidth: 420 }}>
        <h3>Sign in</h3>
        <form onSubmit={signIn}>
          <label>Email</label>
          <input className="modal-input" value={email} onChange={e=>setEmail(e.target.value)} />
          <label>Password</label>
          <input className="modal-input" type="password" value={pw} onChange={e=>setPw(e.target.value)} />
          {err && <p style={{ color: '#f87171' }}>{err}</p>}
          <div style={{ display:'flex', gap:8, marginTop:10 }}>
            <button className="btn primary" disabled={busy}>{busy ? '...' : 'Sign In'}</button>
            <button type="button" className="btn" onClick={signUp} disabled={busy}>Create account</button>
          </div>
        </form>
      </div>
    </div>
  );
}
