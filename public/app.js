// Global state
let currentTab = 'chats';

// Fetch & Refresh Dashboard Data
async function fetchDashboardData() {
  try {
    const res = await fetch('/api/dashboard/stats');
    const data = await res.json();

    // 1. Update Metrics
    document.getElementById('stat-total-calls').innerText = data.stats.totalCalls;
    document.getElementById('stat-missed-calls').innerText = data.stats.missedCalls;
    document.getElementById('stat-voicemails').innerText = data.stats.voicemailsCount;
    document.getElementById('stat-messages').innerText = data.stats.totalMessages;

    // 2. Update Owner Details
    if (data.settings) {
      if (data.settings.ownerName) document.getElementById('owner-name-display').innerText = data.settings.ownerName;
      if (data.settings.ownerPhone) document.getElementById('owner-phone-display').innerText = '+91 ' + data.settings.ownerPhone;
    }

    // 2.1 Update WhatsApp Connection Status & QR Code
    const waPill = document.getElementById('wa-connection-pill');
    const qrContainer = document.getElementById('qr-container');

    if (data.whatsapp && data.whatsapp.isConnected) {
      waPill.className = 'status-pill online';
      waPill.innerHTML = '<span class="pulse-dot"></span> WhatsApp: Connected';
      qrContainer.innerHTML = `
        <div class="qr-connected-badge">
          <span class="check-icon">✅</span>
          <div class="text">Phone Linked!</div>
          <div style="font-size:11px; color:#64748b; margin-top:2px;">${escapeHtml(data.whatsapp.connectedUser || '+91 9457886467')}</div>
        </div>
      `;
    } else {
      waPill.className = 'status-pill offline';
      waPill.innerHTML = '<span class="pulse-dot"></span> Scan QR to Connect';
      if (data.whatsapp && data.whatsapp.qrCode) {
        qrContainer.innerHTML = `<img src="${data.whatsapp.qrCode}" alt="Scan to connect WhatsApp" />`;
      } else {
        qrContainer.innerHTML = '<div class="qr-loading">Generating secure QR code...</div>';
      }
    }

    // 3. Render WhatsApp Messages
    renderChats(data.messages);

    // 4. Render Voicemails
    renderVoicemails(data.voicemails);

    // 5. Render Call Logs
    renderCalls(data.calls);

  } catch (err) {
    console.error('Failed to fetch dashboard data:', err);
  }
}

// Render WhatsApp Chat Bubbles
function renderChats(messages) {
  const container = document.getElementById('chat-messages-list');
  if (!messages || messages.length === 0) {
    container.innerHTML = '<div class="empty-state">No WhatsApp messages yet. Click "Simulate Missed Call" on the left to test!</div>';
    return;
  }

  // Reverse so oldest at top, newest at bottom
  const sorted = [...messages].reverse();

  container.innerHTML = sorted.map(m => {
    const isOutbound = m.direction === 'outbound';
    const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `
      <div class="chat-bubble ${isOutbound ? 'outbound' : 'inbound'}">
        <div class="chat-text">${escapeHtml(m.text)}</div>
        <div class="chat-meta">
          <span>${isOutbound ? '🤖 Assistant' : '👤 ' + escapeHtml(m.from)}</span>
          <span>${time} ${isOutbound ? '✓✓' : ''}</span>
        </div>
      </div>
    `;
  }).join('');

  // Auto-scroll to bottom
  container.scrollTop = container.scrollHeight;
}

// Render Voicemails
function renderVoicemails(voicemails) {
  const container = document.getElementById('voicemail-list');
  if (!voicemails || voicemails.length === 0) {
    container.innerHTML = '<div class="empty-state">No voicemails yet. Click "Record" on the simulator to create a test voicemail.</div>';
    return;
  }

  container.innerHTML = voicemails.map(v => {
    const isUrgent = v.urgency === 'High';
    const time = new Date(v.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
    return `
      <div class="voicemail-card">
        <div class="voicemail-top">
          <div class="voicemail-caller">👤 ${escapeHtml(v.callerName)} <span style="font-weight:400; font-size:12px; color:var(--text-muted);">(${escapeHtml(v.callerNumber)})</span></div>
          <span class="urgency-badge ${isUrgent ? 'high' : 'normal'}">${v.urgency} Priority</span>
        </div>
        <div class="voicemail-transcript">
          <strong>🎙️ Audio Transcript:</strong><br>
          "${escapeHtml(v.transcript)}"
        </div>
        <div class="chat-meta" style="margin-top:8px;">
          <span>Duration: ${v.duration || '0:20s'}</span>
          <span>${time}</span>
        </div>
      </div>
    `;
  }).join('');
}

// Render Calls Table
function renderCalls(calls) {
  const tbody = document.getElementById('calls-table-body');
  if (!calls || calls.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">No calls recorded yet.</td></tr>';
    return;
  }

  tbody.innerHTML = calls.map(c => {
    const isMissed = c.status === 'missed' || c.status === 'no-answer';
    const time = new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
    return `
      <tr>
        <td><strong>${escapeHtml(c.callerName || 'Unknown')}</strong></td>
        <td>${escapeHtml(c.callerNumber)}</td>
        <td><span class="status-badge ${isMissed ? 'missed' : 'completed'}">${isMissed ? '📵 Missed' : '📞 Answered'}</span></td>
        <td style="color:var(--text-muted);">${time}</td>
      </tr>
    `;
  }).join('');
}

// -------------------------------------------------------------
// Interactive Simulator Handlers
// -------------------------------------------------------------

async function simulateMissedCall() {
  const phone = document.getElementById('sim-phone').value.trim();
  const name = document.getElementById('sim-name').value.trim();

  try {
    const res = await fetch('/api/simulate/missed-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callerNumber: phone, callerName: name })
    });
    const data = await res.json();
    if (data.success) {
      switchTab('chats');
      await fetchDashboardData();
    }
  } catch (err) {
    alert('Error running simulation: ' + err.message);
  }
}

async function simulateIncomingWhatsApp() {
  const phone = document.getElementById('sim-phone').value.trim();
  const msg = document.getElementById('sim-msg').value.trim();

  if (!msg) return;

  try {
    const res = await fetch('/api/simulate/incoming-whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callerNumber: phone, userMessage: msg })
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('sim-msg').value = '';
      switchTab('chats');
      await fetchDashboardData();
    }
  } catch (err) {
    alert('Error sending message: ' + err.message);
  }
}

async function simulateVoicemail() {
  const phone = document.getElementById('sim-phone').value.trim();
  const name = document.getElementById('sim-name').value.trim();
  const speech = document.getElementById('sim-voicemail').value.trim();

  if (!speech) return;

  try {
    const res = await fetch('/api/simulate/voicemail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callerNumber: phone, callerName: name, speechText: speech })
    });
    const data = await res.json();
    if (data.success) {
      switchTab('voicemails');
      await fetchDashboardData();
    }
  } catch (err) {
    alert('Error recording voicemail: ' + err.message);
  }
}

// -------------------------------------------------------------
// Tab Switching
// -------------------------------------------------------------

function switchTab(tabId) {
  currentTab = tabId;
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));

  const activeBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.innerText.toLowerCase().includes(tabId.slice(0, 4)));
  if (activeBtn) activeBtn.classList.add('active');

  const pane = document.getElementById('tab-' + tabId);
  if (pane) pane.classList.add('active');
}

// -------------------------------------------------------------
// Settings Modal
// -------------------------------------------------------------

async function openSettingsModal() {
  const res = await fetch('/api/dashboard/stats');
  const data = await res.json();

  document.getElementById('setting-owner').value = data.settings.ownerName || 'Vikas';
  document.getElementById('setting-autoreply').value = data.settings.autoReplyText || '';

  document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettingsModal() {
  document.getElementById('settings-modal').classList.add('hidden');
}

async function saveSettings() {
  const ownerName = document.getElementById('setting-owner').value.trim();
  const autoReplyText = document.getElementById('setting-autoreply').value.trim();
  const geminiApiKey = document.getElementById('setting-gemini').value.trim();
  const twilioAccountSid = document.getElementById('setting-twilio-sid').value.trim();
  const twilioAuthToken = document.getElementById('setting-twilio-token').value.trim();
  const twilioWhatsAppNumber = document.getElementById('setting-twilio-wa').value.trim();

  const payload = { ownerName, autoReplyText };
  if (geminiApiKey) payload.geminiApiKey = geminiApiKey;
  if (twilioAccountSid) payload.twilioAccountSid = twilioAccountSid;
  if (twilioAuthToken) payload.twilioAuthToken = twilioAuthToken;
  if (twilioWhatsAppNumber) payload.twilioWhatsAppNumber = twilioWhatsAppNumber;

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      closeSettingsModal();
      fetchDashboardData();
      alert('Settings updated successfully!');
    }
  } catch (err) {
    alert('Failed to save settings: ' + err.message);
  }
}

// -------------------------------------------------------------
// Live Interactive Voice Agent Call Engine (Pure Hindi & Clean English)
// -------------------------------------------------------------
let isCallActive = false;
let callTimerInterval = null;
let callStartTime = null;
let liveCallHistory = [];
let speechRecognizer = null;
let selectedCallLanguage = 'auto'; // 'auto' | 'hi' | 'en'

function setCallLanguage(lang) {
  selectedCallLanguage = lang;
  document.querySelectorAll('.lang-pill').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById(`lang-btn-${lang}`);
  if (activeBtn) activeBtn.classList.add('active');

  if (isCallActive) {
    if (speechRecognizer) {
      speechRecognizer.lang = (lang === 'en') ? 'en-IN' : 'hi-IN';
    }
    const switchNotice = lang === 'hi' ? "हिन्दी मोड सक्रिय है। बोलिए..." : (lang === 'en' ? "English mode active. Speaking..." : "Auto-detect mode active.");
    document.getElementById('call-status-indicator').innerText = switchNotice;
  }
}

function startLiveVoiceCall() {
  isCallActive = true;
  liveCallHistory = [];
  callStartTime = Date.now();

  document.getElementById('voice-call-modal').classList.remove('hidden');
  document.getElementById('call-status-indicator').innerText = 'Call connected. AI is speaking...';
  document.getElementById('live-call-transcript').innerHTML = '';

  // Start timer
  callTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    document.getElementById('call-timer').innerText = `${mins}:${secs}`;
  }, 1000);

  // Initial Greeting based on selected language
  let greeting = "";
  let langTag = "en-IN";

  if (selectedCallLanguage === 'hi') {
    greeting = "नमस्ते! आपने विकास को कॉल किया है। विकास अभी व्यस्त हैं। आप कृपया बताएं किस काम के बारे में कॉल किया था?";
    langTag = "hi-IN";
  } else if (selectedCallLanguage === 'en') {
    greeting = "Hello! You have reached Vikas's office. Vikas is currently in a meeting. May I ask who is calling and how I can help?";
    langTag = "en-IN";
  } else {
    greeting = "नमस्ते! Hello! You have reached Vikas. Vikas is currently busy. How can I help you today?";
    langTag = "en-IN";
  }

  appendTranscript('AI', greeting);
  speakAIText(greeting, langTag, () => {
    listenToCaller();
  });
}

function listenToCaller() {
  if (!isCallActive) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert('Voice recognition not supported in this browser. Please use Google Chrome or Edge.');
    endLiveVoiceCall();
    return;
  }

  const langHint = (selectedCallLanguage === 'en') ? 'Speak in English' : 'Speak in Hindi or English';
  document.getElementById('call-status-indicator').innerText = `🎙️ Listening to you (${langHint})...`;

  speechRecognizer = new SpeechRecognition();
  speechRecognizer.lang = (selectedCallLanguage === 'en') ? 'en-IN' : 'hi-IN';
  speechRecognizer.interimResults = false;
  speechRecognizer.maxAlternatives = 1;

  speechRecognizer.onresult = async (event) => {
    const userSpeech = event.results[0][0].transcript;
    if (!userSpeech.trim()) return;

    appendTranscript('Caller', userSpeech);
    liveCallHistory.push({ role: 'Caller', text: userSpeech });

    document.getElementById('call-status-indicator').innerText = '🤖 AI is thinking...';

    try {
      const res = await fetch('/api/voice/live-call-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history: liveCallHistory,
          userSpeech: userSpeech,
          languageMode: selectedCallLanguage
        })
      });
      const data = await res.json();
      const reply = data.reply;
      const replyLang = data.lang || 'en-IN';
      const shouldEnd = data.shouldEndCall;

      liveCallHistory.push({ role: 'Assistant', text: reply });
      appendTranscript('AI', reply);

      speakAIText(reply, replyLang, () => {
        if (shouldEnd) {
          setTimeout(() => {
            endLiveVoiceCall();
          }, 2000);
        } else {
          listenToCaller(); // Continue conversation
        }
      });

    } catch (err) {
      console.error('Call turn error:', err);
      listenToCaller();
    }
  };

  speechRecognizer.onerror = (e) => {
    console.warn('Speech recognition error:', e.error);
    if (isCallActive && e.error !== 'aborted') {
      setTimeout(() => listenToCaller(), 1500);
    }
  };

  speechRecognizer.onend = () => {
    // Keep alive if listening
  };

  try {
    speechRecognizer.start();
  } catch (err) {
    console.warn('Speech start error:', err);
  }
}

function speakAIText(text, langHint, onComplete) {
  if (!window.speechSynthesis) {
    if (onComplete) onComplete();
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);

  const isHindi = /[\u0900-\u097F]/.test(text) || langHint === 'hi-IN';
  const voices = window.speechSynthesis.getVoices();

  if (isHindi) {
    utterance.lang = 'hi-IN';
    // Find genuine Hindi voice
    const hindiVoice = voices.find(v => v.lang.includes('hi') || v.name.includes('Hindi') || v.name.includes('हिन्दी') || v.name.includes('Swara') || v.name.includes('Kalpana') || v.name.includes('Madhur') || v.name.includes('Hemant'));
    if (hindiVoice) utterance.voice = hindiVoice;
    utterance.rate = 0.95; // Slightly slower for clear Hindi pronunciation
    utterance.pitch = 1.0;
  } else {
    utterance.lang = 'en-IN';
    // Find natural Indian English or clear English voice
    const englishVoice = voices.find(v => v.lang.includes('en-IN') || v.name.includes('Neerja') || v.name.includes('Prabhat') || v.name.includes('Natural')) ||
                         voices.find(v => v.lang.includes('en-GB') || v.lang.includes('en-US'));
    if (englishVoice) utterance.voice = englishVoice;
    utterance.rate = 1.0;
    utterance.pitch = 1.02;
  }

  document.getElementById('call-status-indicator').innerText = '🔊 AI is speaking...';

  utterance.onend = () => {
    if (onComplete) onComplete();
  };
  utterance.onerror = () => {
    if (onComplete) onComplete();
  };

  window.speechSynthesis.speak(utterance);
}

function appendTranscript(speaker, text) {
  const box = document.getElementById('live-call-transcript');
  const line = document.createElement('div');
  line.className = `transcript-line ${speaker === 'AI' ? 'ai' : 'user'}`;
  line.innerHTML = `<strong>${speaker}:</strong> "${escapeHtml(text)}"`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

async function endLiveVoiceCall() {
  isCallActive = false;
  if (callTimerInterval) clearInterval(callTimerInterval);
  if (speechRecognizer) {
    try { speechRecognizer.stop(); } catch (e) {}
  }
  if (window.speechSynthesis) window.speechSynthesis.cancel();

  document.getElementById('voice-call-modal').classList.add('hidden');

  // Save transcript to backend if there was a conversation
  if (liveCallHistory.length > 0) {
    const fullTranscript = liveCallHistory.map(h => `${h.role}: ${h.text}`).join('\n');
    const duration = document.getElementById('call-timer').innerText || '0:25';

    await fetch('/api/voice/save-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callerName: 'Live Voice Test Caller',
        callerNumber: '+91 9457886467',
        transcript: fullTranscript,
        duration: duration
      })
    });

    switchTab('voicemails');
    fetchDashboardData();
  }
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Polling and Init
fetchDashboardData();
setInterval(fetchDashboardData, 3000);
