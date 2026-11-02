import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000';

async function request(path, token, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'حدث خطأ. حاول مرة أخرى');
  return data;
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('sc_token') || '');
  const [me, setMe] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sc_user') || 'null'); } catch { return null; }
  });
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [users, setUsers] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [socket, setSocket] = useState(null);
  const bottomRef = useRef(null);
  const activeRef = useRef(null);
  useEffect(() => { activeRef.current = active; }, [active]);

  const activeTitle = useMemo(() => active?.username || 'اختر محادثة', [active]);

  useEffect(() => {
    if (!token) return;
    request('/api/users', token).then(setUsers).catch((e) => setError(e.message));
    const s = io(API, { auth: { token }, transports: ['websocket', 'polling'] });
    setSocket(s);
    s.on('new-message', (message) => {
      const current = activeRef.current;
      if (current && [message.senderId, message.receiverId].includes(current.id)) {
        setMessages((old) => old.some((m) => m.id === message.id) ? old : [...old, message]);
      }
    });
    return () => { s.disconnect(); setSocket(null); };
  }, [token]);

  useEffect(() => {
    if (!active || !token) return;
    socket?.emit('join-chat', active.id);
    request(`/api/messages/${active.id}`, token)
      .then(setMessages)
      .catch((e) => setError(e.message));
  }, [active, token, socket]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function submitAuth(e) {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const data = await request(`/api/${mode}`, '', {
        method: 'POST', body: JSON.stringify({ username, password })
      });
      localStorage.setItem('sc_token', data.token);
      localStorage.setItem('sc_user', JSON.stringify(data.user));
      setToken(data.token); setMe(data.user); setPassword('');
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  function logout() {
    localStorage.removeItem('sc_token'); localStorage.removeItem('sc_user');
    setToken(''); setMe(null); setUsers([]); setActive(null); setMessages([]);
  }

  function send(e) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !active || !socket) return;
    setDraft('');
    socket.emit('send-message', { receiverId: active.id, body }, (result) => {
      if (result?.error) setError(result.error);
      else if (result?.message) {
        setMessages((old) => old.some((m) => m.id === result.message.id) ? old : [...old, result.message]);
      }
    });
  }

  if (!token || !me) {
    return (
      <main className="auth-wrap">
        <section className="auth-card">
          <div className="brand-mark">S</div>
          <div className="eyebrow">تواصل بلا تعقيد</div>
          <h1>SABRY <span>CHAT</span></h1>
          <p className="muted">مساحتك الخاصة للمحادثات</p>
          <form onSubmit={submitAuth}>
            <label>اسم المستخدم</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="مثال: sabry_01" autoComplete="username" required />
            <label>كلمة المرور</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8 أحرف على الأقل" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
            {error && <div className="error">{error}</div>}
            <button className="primary full" disabled={loading}>{loading ? 'لحظة...' : mode === 'login' ? 'تسجيل الدخول' : 'إنشاء حساب'}</button>
          </form>
          <button className="link-button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
            {mode === 'login' ? 'ليس لديك حساب؟ أنشئ حسابًا' : 'لديك حساب بالفعل؟ سجّل الدخول'}
          </button>
          <p className="tiny">نسخة أولية — لا تستخدم كلمة مرورك الأساسية هنا.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${active ? 'mobile-hidden' : ''}`}>
        <header className="side-head">
          <div className="brand-small"><div className="brand-mark mini">S</div><div><b>SABRY CHAT</b><small>مساحتك للتواصل</small></div></div>
          <button className="icon-btn" onClick={logout} title="تسجيل الخروج">↪</button>
        </header>
        <div className="profile-strip"><div className="avatar self">{me.username.slice(0,1).toUpperCase()}</div><div><b>{me.username}</b><small>حسابك الشخصي</small></div><span className="online-dot"></span></div>
        <div className="section-title">المحادثات <span>{users.length}</span></div>
        <div className="people-list">
          {users.length === 0 && <div className="empty-users">لا يوجد مستخدمون بعد.<br/>أنشئ حسابًا آخر لتجربة المحادثة.</div>}
          {users.map((u) => (
            <button key={u.id} className={`person ${active?.id === u.id ? 'selected' : ''}`} onClick={() => { setActive(u); setError(''); }}>
              <div className="avatar">{u.username.slice(0,1).toUpperCase()}</div>
              <div className="person-info"><b>{u.username}</b><small>ابدأ محادثة جديدة</small></div>
              <span className="chevron">‹</span>
            </button>
          ))}
        </div>
        <div className="side-foot">SABRY CHAT <span>•</span> إصدار تجريبي</div>
      </aside>

      <section className={`chat-panel ${!active ? 'mobile-hidden' : ''}`}>
        {!active ? (
          <div className="welcome">
            <div className="welcome-icon">✦</div>
            <h2>أهلًا بك في SABRY CHAT</h2>
            <p>اختر شخصًا من القائمة وابدأ محادثة فورية.</p>
            <div className="welcome-note">أنشئ حسابًا آخر من نافذة خاصة أو جهاز آخر لتجربة الدردشة.</div>
          </div>
        ) : (
          <>
            <header className="chat-head">
              <button className="back-btn" onClick={() => setActive(null)}>→</button>
              <div className="avatar">{active.username.slice(0,1).toUpperCase()}</div>
              <div className="chat-person"><b>{activeTitle}</b><small><i></i> محادثة مباشرة</small></div>
              <div className="secure-label">اتصال مباشر</div>
            </header>
            <div className="messages">
              {messages.length === 0 && <div className="date-pill">بداية المحادثة</div>}
              {messages.map((m) => {
                const mine = m.senderId === me.id;
                return <div key={m.id} className={`message-row ${mine ? 'mine' : ''}`}>
                  <div className="bubble">{m.body}<small>{new Date(m.createdAt.replace(' ', 'T') + 'Z').toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</small></div>
                </div>;
              })}
              <div ref={bottomRef} />
            </div>
            {error && <div className="inline-error">{error}</div>}
            <form className="composer" onSubmit={send}>
              <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="اكتب رسالتك هنا..." maxLength={4000} />
              <button className="send-btn" disabled={!draft.trim()} aria-label="إرسال">➤</button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
