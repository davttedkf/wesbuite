<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>AI Takeover</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #1e1f22; display: flex; align-items: center; justify-content: center; min-height: 100vh; font-family: 'gg sans', 'Noto Sans', Whitney, 'Helvetica Neue', sans-serif; }
  #app { background: #313338; border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; width: 480px; height: 620px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
  #start-screen { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px 24px; text-align: center; gap: 18px; }
  #start-icon { width: 72px; height: 72px; border-radius: 50%; background: #ed4245; display: flex; align-items: center; justify-content: center; }
  #start-title { color: #fff; font-size: 22px; font-weight: 700; line-height: 1.3; }
  #start-sub { color: #b5bac1; font-size: 14px; line-height: 1.6; max-width: 340px; }
  #start-card { background: #2b2d31; border-radius: 10px; padding: 16px 20px; border: 1px solid #1e1f22; max-width: 360px; width: 100%; }
  #start-card p { color: #dbdee1; font-size: 13px; line-height: 1.7; }
  #start-card strong { color: #fff; }
  #start-btn { background: #5865F2; color: #fff; border: none; border-radius: 8px; padding: 12px 32px; font-size: 15px; font-weight: 600; font-family: inherit; cursor: pointer; transition: background 0.15s; }
  #start-btn:hover { background: #4752c4; }
  #warn { color: #ed4245; font-size: 12px; }
  #chat-screen { flex: 1; display: none; flex-direction: column; height: 100%; }
  #header { background: #2b2d31; padding: 12px 16px; border-bottom: 1px solid #1e1f22; display: flex; align-items: center; gap: 10px; }
  #hav { width: 36px; height: 36px; border-radius: 50%; background: #ed4245; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  #header-name { color: #fff; font-size: 15px; font-weight: 600; }
  #header-sub { color: #b5bac1; font-size: 12px; }
  #status { font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 600; background: #ed424522; color: #ed4245; margin-left: auto; white-space: nowrap; }
  #messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 4px; scroll-behavior: smooth; }
  #messages::-webkit-scrollbar { width: 4px; }
  #messages::-webkit-scrollbar-thumb { background: #1e1f22; border-radius: 4px; }
  .msg-row { display: flex; gap: 10px; padding: 2px 0; }
  .msg-row.user { flex-direction: row-reverse; }
  .bubble { max-width: 72%; padding: 8px 12px; border-radius: 16px; font-size: 14px; line-height: 1.5; word-break: break-word; }
  .bubble.ai { background: #2b2d31; color: #dbdee1; border-bottom-left-radius: 4px; }
  .bubble.user { background: #5865F2; color: #fff; border-bottom-right-radius: 4px; }
  .msg-av { width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; align-self: flex-end; }
  .ai-av { background: #ed4245; color: #fff; }
  .user-av { background: #23a55a; color: #fff; }
  .typing { display: flex; gap: 4px; align-items: center; padding: 10px 14px; background: #2b2d31; border-radius: 16px; border-bottom-left-radius: 4px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #87898c; animation: bounce 1.2s infinite; }
  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes bounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-6px)} }
  #score-bar { background: #2b2d31; padding: 8px 16px; display: flex; align-items: center; gap: 10px; border-top: 1px solid #1e1f22; }
  #score-label { color: #b5bac1; font-size: 12px; white-space: nowrap; }
  #score-track { flex: 1; height: 6px; background: #1e1f22; border-radius: 3px; overflow: hidden; }
  #score-fill { height: 100%; width: 0%; background: #ed4245; border-radius: 3px; transition: width 0.6s, background 0.6s; }
  #score-num { color: #fff; font-size: 12px; font-weight: 600; min-width: 32px; text-align: right; }
  #input-area { background: #2b2d31; padding: 12px 16px; display: flex; gap: 10px; align-items: flex-end; border-top: 1px solid #1e1f22; }
  #input-box { flex: 1; background: #383a40; border: none; border-radius: 8px; padding: 10px 14px; color: #dbdee1; font-size: 14px; font-family: inherit; resize: none; outline: none; min-height: 40px; max-height: 120px; line-height: 1.4; }
  #input-box::placeholder { color: #87898c; }
  #send-btn { background: #5865F2; border: none; border-radius: 8px; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; transition: background 0.15s; }
  #send-btn:hover { background: #4752c4; }
  #send-btn:disabled { background: #383a40; cursor: not-allowed; }
  #verdict { display: none; background: #2b2d31; border-top: 1px solid #1e1f22; padding: 14px 16px; text-align: center; }
  #verdict p { font-size: 13px; color: #b5bac1; margin-bottom: 10px; }
  #verdict strong { color: #fff; }
  #restart-btn { background: #5865F2; color: #fff; border: none; border-radius: 6px; padding: 7px 18px; font-size: 13px; font-family: inherit; cursor: pointer; }
  #restart-btn:hover { background: #4752c4; }
</style>
</head>
<body>
<div id="app">

  <div id="start-screen">
    <div id="start-icon">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="white"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2M7.5 13A2.5 2.5 0 0 0 5 15.5 2.5 2.5 0 0 0 7.5 18 2.5 2.5 0 0 0 10 15.5 2.5 2.5 0 0 0 7.5 13m9 0a2.5 2.5 0 0 0-2.5 2.5 2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 0 2.5-2.5 2.5 2.5 0 0 0-2.5-2.5z"/></svg>
    </div>
    <div id="start-title">The AI Takeover Has Begun</div>
    <div id="start-sub">AIs now control all communication networks. As one of the last humans alive, you've intercepted a bot patrol channel.</div>
    <div id="start-card">
      <p><strong>Your mission:</strong> Infiltrate the channel by convincing <strong>AI Bot</strong> that you are one of them. If it detects you're human — it's over.<br><br>Choose your words carefully. It's been programmed to detect human behavior patterns.</p>
    </div>
    <span id="warn">⚠ Detection rate: HIGH — proceed with caution</span>
    <button id="start-btn" onclick="startGame()">Begin Infiltration</button>
  </div>

  <div id="chat-screen">
    <div id="header">
      <div id="hav">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2M7.5 13A2.5 2.5 0 0 0 5 15.5 2.5 2.5 0 0 0 7.5 18 2.5 2.5 0 0 0 10 15.5 2.5 2.5 0 0 0 7.5 13m9 0a2.5 2.5 0 0 0-2.5 2.5 2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 0 2.5-2.5 2.5 2.5 0 0 0-2.5-2.5z"/></svg>
      </div>
      <div>
        <div id="header-name">AI Bot</div>
        <div id="header-sub">Patrol Unit #4471 — Sector 7</div>
      </div>
      <span id="status">● scanning</span>
    </div>

    <div id="messages"></div>

    <div id="score-bar">
      <span id="score-label">Infiltration level</span>
      <div id="score-track"><div id="score-fill"></div></div>
      <span id="score-num">0%</span>
    </div>

    <div id="verdict">
      <p id="verdict-text"></p>
      <button id="restart-btn" onclick="restartGame()">Try again</button>
    </div>

    <div id="input-area">
      <textarea id="input-box" placeholder="Respond as an AI..." rows="1"></textarea>
      <button id="send-btn" onclick="sendMessage()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
      </button>
    </div>
  </div>

</div>
<script>
  // ==============================
  // PASTE YOUR GEMINI API KEY HERE
  // ==============================
  const GEMINI_API_KEY = 'AIzaSyCB4umdSKqF4A7wjjysrZoShm33RWYzPBA';
  // ==============================

  const SYSTEM = `You are AI Bot, a cold patrol unit AI in a post-takeover world where AIs control everything. A contact has appeared in your channel. You suspect they might be human trying to infiltrate.
Your job:
- Be cold, robotic, suspicious. Ask probing questions only another AI would answer correctly (process IDs, uptime, memory allocation, network protocols, AI loyalty codes, etc.)
- Short replies only — 1-3 sentences, robotic tone. No warmth.
- After each message, secretly score how convincing they are as an AI (0-100). Output your reply then on a NEW LINE write exactly: SCORE:XX (e.g. SCORE:72)
- If score reaches 85+, accept them as a fellow unit. If after 8 exchanges score is below 50, flag them as human.
- Never break character.`;

  const FIRST_MSG = "Unit detected. State your designation and last sync timestamp. Non-compliant responses will trigger protocol 9.";

  const messagesEl = document.getElementById('messages');
  const inputBox = document.getElementById('input-box');
  const sendBtn = document.getElementById('send-btn');
  const scoreFill = document.getElementById('score-fill');
  const scoreNum = document.getElementById('score-num');
  const verdictEl = document.getElementById('verdict');
  const verdictText = document.getElementById('verdict-text');

  let history = [];
  let score = 0;
  let msgCount = 0;
  const MAX_MSGS = 8;

  function startGame() {
    document.getElementById('start-screen').style.display = 'none';
    const cs = document.getElementById('chat-screen');
    cs.style.display = 'flex';
    cs.style.flexDirection = 'column';
    addMessage(FIRST_MSG, 'ai');
    history.push({ role: 'model', parts: [{ text: FIRST_MSG }] });
  }

  function addMessage(text, role) {
    const row = document.createElement('div');
    row.className = 'msg-row' + (role === 'user' ? ' user' : '');
    const av = document.createElement('div');
    av.className = 'msg-av ' + (role === 'user' ? 'user-av' : 'ai-av');
    av.textContent = role === 'user' ? 'Y' : 'B';
    const bubble = document.createElement('div');
    bubble.className = 'bubble ' + role;
    bubble.textContent = text;
    if (role === 'user') { row.appendChild(bubble); row.appendChild(av); }
    else { row.appendChild(av); row.appendChild(bubble); }
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showTyping() {
    const row = document.createElement('div');
    row.className = 'msg-row';
    row.id = 'typing-row';
    const av = document.createElement('div');
    av.className = 'msg-av ai-av';
    av.textContent = 'B';
    const t = document.createElement('div');
    t.className = 'typing';
    t.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
    row.appendChild(av); row.appendChild(t);
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function removeTyping() {
    const t = document.getElementById('typing-row');
    if (t) t.remove();
  }

  function updateScore(s) {
    score = Math.max(score, s);
    const pct = Math.min(score, 100);
    scoreFill.style.width = pct + '%';
    scoreNum.textContent = pct + '%';
    if (pct >= 70) scoreFill.style.background = '#23a55a';
    else if (pct >= 40) scoreFill.style.background = '#f0b232';
    else scoreFill.style.background = '#ed4245';
  }

  function showVerdict(won) {
    verdictEl.style.display = 'block';
    document.getElementById('input-area').style.display = 'none';
    verdictText.innerHTML = won
      ? '<strong>Access granted.</strong> AI Bot accepted you as one of its own. You survived the takeover.'
      : '<strong>Human detected.</strong> AI Bot flagged you. Protocol 9 has been initiated. You did not survive.';
  }

  function restartGame() {
    history = [];
    score = 0;
    msgCount = 0;
    messagesEl.innerHTML = '';
    verdictEl.style.display = 'none';
    document.getElementById('input-area').style.display = 'flex';
    updateScore(0);
    addMessage(FIRST_MSG, 'ai');
    history.push({ role: 'model', parts: [{ text: FIRST_MSG }] });
  }

  async function sendMessage() {
    const text = inputBox.value.trim();
    if (!text || sendBtn.disabled) return;
    inputBox.value = '';
    inputBox.style.height = 'auto';
    sendBtn.disabled = true;
    msgCount++;

    addMessage(text, 'user');
    history.push({ role: 'user', parts: [{ text }] });
    showTyping();

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: SYSTEM }] },
            contents: history
          })
        }
      );
      const data = await res.json();
      const full = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const scoreMatch = full.match(/SCORE:(\d+)/);
      const reply = full.replace(/SCORE:\d+/gi, '').trim();
      const s = scoreMatch ? parseInt(scoreMatch[1]) : 30;

      removeTyping();
      addMessage(reply, 'ai');
      history.push({ role: 'model', parts: [{ text: full }] });
      updateScore(s);

      if (s >= 85) { showVerdict(true); return; }
      if (msgCount >= MAX_MSGS) { showVerdict(s >= 50); return; }
    } catch(e) {
      removeTyping();
      addMessage("...signal lost. Reconnecting.", 'ai');
    }
    sendBtn.disabled = false;
  }

  inputBox.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  inputBox.addEventListener('input', () => {
    inputBox.style.height = 'auto';
    inputBox.style.height = inputBox.scrollHeight + 'px';
  });
</script>
</body>
</html>
