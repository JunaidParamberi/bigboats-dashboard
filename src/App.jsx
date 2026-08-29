import { useState, useEffect, useRef, useCallback } from 'react';

const API = {
  conversations: '/api/conversations',
  reply:         '/api/reply',
  takeover:      '/api/takeover',
};

const REFRESH_MS = 30_000;

function fmt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7)  return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function fmtTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function groupByPhone(rows) {
  const map = new Map();
  for (const row of rows) {
    const phone = row.phone || row.from || row.contact_phone || '';
    if (!phone) continue;
    if (!map.has(phone)) {
      map.set(phone, {
        phone,
        name: row.name || row.contact_name || phone,
        mode: row.mode || 'ai',
        messages: [],
        unread: 0,
      });
    }
    const c = map.get(phone);
    if (row.message || row.body || row.text) {
      c.messages.push({
        id:        row.id || row.message_id || Math.random().toString(36).slice(2),
        direction: row.direction || (row.from_me ? 'outgoing' : 'incoming'),
        text:      row.message || row.body || row.text || '',
        ts:        row.timestamp || row.created_at || row.time || null,
      });
    }
    if (row.mode) c.mode = row.mode;
    if (row.unread_count != null) c.unread = row.unread_count;
  }
  for (const c of map.values()) {
    c.messages.sort((a, b) => new Date(a.ts || 0) - new Date(b.ts || 0));
    const last = c.messages[c.messages.length - 1];
    c.lastTs   = last?.ts || null;
    c.preview  = last?.text || '';
  }
  return [...map.values()].sort((a, b) => new Date(b.lastTs || 0) - new Date(a.lastTs || 0));
}

export default function App() {
  const [conversations, setConversations] = useState([]);
  const [currentPhone, setCurrentPhone]   = useState(null);
  const [modes, setModes]                 = useState({});      // { phone: 'ai'|'human' }
  const [loading, setLoading]             = useState(true);
  const [refreshing, setRefreshing]       = useState(false);
  const [error, setError]                 = useState(null);
  const [toast, setToast]                 = useState(null);    // { msg, type }
  const [filter, setFilter]               = useState('all');   // all | ai | human | unread
  const [search, setSearch]               = useState('');
  const [replyText, setReplyText]         = useState('');
  const [sending, setSending]             = useState(false);

  const messagesRef     = useRef(null);
  const textareaRef     = useRef(null);
  const refreshTimerRef = useRef(null);
  const toastTimerRef   = useRef(null);

  const currentConvo = conversations.find(c => c.phone === currentPhone) || null;
  const inChat       = !!currentPhone;

  // ── Toast ──────────────────────────────────────────────
  const showToast = useCallback((msg, type = 'info') => {
    setToast({ msg, type });
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // ── Load conversations ──────────────────────────────────
  const loadConversations = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    setError(null);
    try {
      const res  = await fetch(API.conversations);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to load');
      const grouped = groupByPhone(data.conversations || []);
      setConversations(grouped);
      setModes(prev => {
        const next = { ...prev };
        grouped.forEach(c => { if (!next[c.phone]) next[c.phone] = c.mode; });
        return next;
      });
    } catch (e) {
      setError(e.message);
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showToast]);

  // ── Auto-refresh ────────────────────────────────────────
  const stopAutoRefresh  = useCallback(() => clearInterval(refreshTimerRef.current), []);
  const startAutoRefresh = useCallback(() => {
    stopAutoRefresh();
    refreshTimerRef.current = setInterval(() => loadConversations(true), REFRESH_MS);
  }, [loadConversations, stopAutoRefresh]);

  useEffect(() => {
    loadConversations();
    startAutoRefresh();
    return () => { stopAutoRefresh(); clearTimeout(toastTimerRef.current); };
  }, []);   // eslint-disable-line

  // pause auto-refresh while in chat
  useEffect(() => {
    if (inChat) stopAutoRefresh(); else startAutoRefresh();
  }, [inChat]);   // eslint-disable-line

  // scroll to bottom on new messages
  useEffect(() => {
    if (messagesRef.current)
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [currentConvo?.messages?.length]);

  // ── Open chat ───────────────────────────────────────────
  const openChat = (phone) => {
    setCurrentPhone(phone);
    setReplyText('');
    setTimeout(() => {
      messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight });
      textareaRef.current?.focus();
    }, 320);
  };

  const goBack = () => { setCurrentPhone(null); setReplyText(''); };

  // ── Toggle AI / Human ───────────────────────────────────
  const toggleMode = async (phone) => {
    const current = modes[phone] || 'ai';
    const next    = current === 'ai' ? 'human' : 'ai';
    setModes(prev => ({ ...prev, [phone]: next }));
    try {
      const res  = await fetch(API.takeover, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, mode: next }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Takeover failed');
      showToast(`Mode → ${next.toUpperCase()}`);
    } catch (e) {
      setModes(prev => ({ ...prev, [phone]: current }));
      showToast(e.message, 'error');
    }
  };

  // ── Send reply ──────────────────────────────────────────
  const sendReply = async () => {
    const text = replyText.trim();
    if (!text || !currentPhone || sending) return;
    setSending(true);
    const optimistic = {
      id: 'opt-' + Date.now(), direction: 'outgoing', text, ts: new Date().toISOString(),
    };
    setConversations(prev => prev.map(c =>
      c.phone !== currentPhone ? c : {
        ...c,
        messages: [...c.messages, optimistic],
        preview:  text,
        lastTs:   optimistic.ts,
      }
    ));
    setReplyText('');
    try {
      const res  = await fetch(API.reply, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: currentPhone, message: text }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Send failed');
    } catch (e) {
      // remove optimistic on failure
      setConversations(prev => prev.map(c =>
        c.phone !== currentPhone ? c : {
          ...c,
          messages: c.messages.filter(m => m.id !== optimistic.id),
        }
      ));
      setReplyText(text);
      showToast(e.message, 'error');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); }
  };

  // ── Filtered list ───────────────────────────────────────
  const filtered = conversations.filter(c => {
    if (filter === 'ai'     && (modes[c.phone] || c.mode) !== 'ai')    return false;
    if (filter === 'human'  && (modes[c.phone] || c.mode) !== 'human') return false;
    if (filter === 'unread' && !c.unread)                              return false;
    if (search) {
      const q = search.toLowerCase();
      if (!c.name.toLowerCase().includes(q) && !c.phone.includes(q) && !c.preview.toLowerCase().includes(q))
        return false;
    }
    return true;
  });

  const mode = currentConvo ? (modes[currentConvo.phone] || currentConvo.mode || 'ai') : 'ai';

  return (
    <div className="app">

      {/* ── LIST VIEW ── */}
      <div className={`view view-list ${inChat ? 'slide-out' : ''}`}>
        <div className="header">
          <div style={{ flex: 1 }}>
            <h1>Big Boats UAE</h1>
            <span className="subtitle">WhatsApp Dashboard</span>
          </div>
          <button
            className={`refresh-btn ${refreshing ? 'spinning' : ''}`}
            onClick={() => loadConversations(true)}
            title="Refresh"
          >⟳</button>
        </div>

        <div className="search-bar">
          <input
            placeholder="Search chats…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="filter-bar">
          {['all', 'ai', 'human', 'unread'].map(f => (
            <button
              key={f}
              className={`chip ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f === 'ai' ? '🤖 AI' : f === 'human' ? '👤 Human' : '🔴 Unread'}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="empty-state"><div className="spinner" /></div>
        ) : error ? (
          <div className="empty-state">
            <span className="empty-icon">⚠️</span>
            <p>{error}</p>
            <button className="chip active" onClick={() => loadConversations()}>Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">💬</span>
            <p>{search || filter !== 'all' ? 'No matching chats' : 'No conversations yet'}</p>
          </div>
        ) : (
          <div className="convo-list">
            {filtered.map(c => {
              const m = modes[c.phone] || c.mode || 'ai';
              return (
                <div key={c.phone} className="convo-item" onClick={() => openChat(c.phone)}>
                  <div className="avatar">{initials(c.name)}</div>
                  <div className="convo-info">
                    <div className="convo-top">
                      <span className="convo-name">{c.name}</span>
                      <span className="convo-time">{fmt(c.lastTs)}</span>
                    </div>
                    <div className="convo-preview">{c.preview}</div>
                  </div>
                  <span className={`mode-pill ${m}`}>{m === 'ai' ? '🤖' : '👤'}</span>
                  {c.unread > 0 && <span className="badge">{c.unread}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── CHAT VIEW ── */}
      <div className={`view view-chat ${inChat ? 'slide-in' : ''}`}>
        {currentConvo && (
          <>
            <div className="chat-header">
              <button className="back-btn" onClick={goBack}>←</button>
              <div style={{ flex: 1 }}>
                <div className="chat-name">{currentConvo.name}</div>
                <div className="chat-phone">{currentConvo.phone}</div>
              </div>
              <div className="mode-toggle">
                <span className="mode-label">{mode === 'ai' ? '🤖 AI' : '👤 Human'}</span>
                <div
                  className={`toggle-switch ${mode === 'human' ? 'on' : ''}`}
                  onClick={() => toggleMode(currentConvo.phone)}
                  title={`Switch to ${mode === 'ai' ? 'human' : 'AI'}`}
                >
                  <div className="toggle-knob" />
                </div>
              </div>
            </div>

            <div className="messages" ref={messagesRef}>
              {currentConvo.messages.length === 0 ? (
                <div className="empty-state" style={{ background: 'transparent' }}>
                  <span className="empty-icon">💬</span>
                  <p>No messages</p>
                </div>
              ) : (
                currentConvo.messages.map((m, i) => {
                  const prev = currentConvo.messages[i - 1];
                  const showDate = !prev || new Date(m.ts).toDateString() !== new Date(prev?.ts).toDateString();
                  return (
                    <div key={m.id}>
                      {showDate && m.ts && (
                        <div className="date-divider">
                          {new Date(m.ts).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })}
                        </div>
                      )}
                      <div className={`msg ${m.direction}`}>
                        <div className="msg-bubble">{m.text}</div>
                        <div className="msg-meta">{fmtTime(m.ts)}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="reply-bar">
              <textarea
                ref={textareaRef}
                rows={1}
                placeholder="Type a message…"
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <button
                className="send-btn"
                onClick={sendReply}
                disabled={!replyText.trim() || sending}
                title="Send"
              >➤</button>
            </div>
          </>
        )}
      </div>

      {toast && <div className={`toast ${toast.type === 'error' ? 'error' : ''}`}>{toast.msg}</div>}
    </div>
  );
}
