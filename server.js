const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { startWhatsAppBot, sendDirectWhatsApp, getWhatsAppStatus } = require('./whatsapp-client');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Ensure data folder and db.json exist
const dataDir = path.join(__dirname, 'data');
const dbFile = path.join(dataDir, 'db.json');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const defaultDB = {
  calls: [],
  voicemails: [],
  messages: [],
  settings: {
    ownerName: 'Vikas',
    ownerPhone: '9457886467',
    autoReplyText: "Hey! Vikas here. I couldn't take your call right now. Is there anything urgent? Reply here and let me know!",
    geminiApiKey: process.env.GEMINI_API_KEY || ''
  }
};

function readDB() {
  try {
    if (!fs.existsSync(dbFile)) {
      fs.writeFileSync(dbFile, JSON.stringify(defaultDB, null, 2));
      return defaultDB;
    }
    const raw = fs.readFileSync(dbFile, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading DB:', err);
    return defaultDB;
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error writing DB:', err);
  }
}

// -------------------------------------------------------------
// Human Takeover & Conversation State Engine
// -------------------------------------------------------------
// Tracks when Vikas himself sent a message to this contact
const humanActiveMap = {}; // phone -> timestamp
// Tracks bot replies count so bot never loops endlessly
const botReplyCount = {}; // phone -> count

// Filler words / casual phrases that should NEVER trigger a bot reply
const SILENT_PATTERNS = [
  /^(ok|okay|okk|k|kk|thik|theek|hmm+|hm|haan|ha|hn|na|nahi|no|nope|bye|gn|gm|bolo|bol|sun|bass|bas)\b/i,
  /\b(kuch ni|kuch nahi|kuch nhi|kuch na|kuch nai|nothing)\b/i,
  /\b(thanks|thank you|thank u|thx|shukriya|dhanyawad|welcome)\b/i,
  /\b(krta hu|karta hu|karti hu|krte h|karunga|karungi|krunga|call karta hu|call krta hu)\b/i,
  /\b(baad me|bad me|free hoke|free hokar|free hokr|bahar hu|bahar hoon|busy hu|busy hoon|drive kar|driving|meeting me)\b/i,
  /\b(chup|chup kar|nikal|pagal|fuck off|shut up)\b/i
];

function isFillerWord(text) {
  if (!text) return true;
  const cleaned = text.trim().toLowerCase();
  if (cleaned.length <= 1) return true; // Single characters like "h", "a"
  return SILENT_PATTERNS.some(regex => regex.test(cleaned));
}

async function generateAIResponse(senderPhone, userMessage) {
  const now = Date.now();
  const db = readDB();
  const owner = db.settings.ownerName || 'Vikas';

  // RULE 1: If Vikas actively messaged this person in the last 45 minutes, STAY SILENT!
  const lastHumanTime = humanActiveMap[senderPhone] || 0;
  if (now - lastHumanTime < 45 * 60 * 1000) {
    console.log(`🤫 Human (Vikas) is active in this chat. Bot muted for ${senderPhone}.`);
    return null;
  }

  // RULE 2: If the message is a filler word ("ok", "kuch ni", "hmm"), STAY SILENT!
  if (isFillerWord(userMessage)) {
    console.log(`🤫 Message is filler/acknowledgment ("${userMessage}"). Bot staying silent.`);
    return null;
  }

  // RULE 3: Max 2 bot replies per conversation session to avoid annoying the caller
  const count = botReplyCount[senderPhone] || 0;
  if (count >= 2) {
    console.log(`🤫 Already sent ${count} replies to ${senderPhone}. Capping conversation.`);
    return null;
  }

  // RULE 4: Generate context-aware reply
  const trimmed = userMessage.trim().toLowerCase();
  let reply = '';

  const isUrgent = /(urgent|emergency|jaldi|important|turant|abhibhi)/i.test(trimmed);
  const isGreeting = /^(hi|hello|hey|namaste|hii|hiii|hlo)\b/i.test(trimmed);
  const isQuestion = trimmed.includes('?') || /(kya|kab|kaise|what|when|where|who|why|cost|price|demo|quotation)/i.test(trimmed);

  if (isUrgent) {
    reply = `Got it, I understand this is urgent! I've flagged this for ${owner} with top priority. He will call you back as soon as he is free.`;
  } else if (isGreeting) {
    reply = `Hello! Thanks for reaching out. ${owner} is currently tied up. What's on your mind?`;
  } else if (isQuestion) {
    reply = `Thanks for asking. ${owner} handles all discussions directly. I've noted your question and asked him to get back to you!`;
  } else {
    reply = `Got it! I've noted that down for ${owner}. He'll check this and follow up shortly.`;
  }

  botReplyCount[senderPhone] = count + 1;
  return reply;
}

// -------------------------------------------------------------
// WhatsApp Client Initialization & Message Handler
// -------------------------------------------------------------
startWhatsAppBot(
  // 1. Inbound message handler
  async (senderPhone, incomingText) => {
    const db = readDB();

    // Log message
    const userMsg = {
      id: 'msg_' + Date.now(),
      from: '+' + senderPhone,
      to: db.settings.ownerName,
      direction: 'inbound',
      text: incomingText,
      timestamp: new Date().toISOString()
    };
    db.messages.push(userMsg);

    // Generate intelligent reply (or null if silent)
    const aiReply = await generateAIResponse(senderPhone, incomingText);

    if (aiReply) {
      const aiMsg = {
        id: 'msg_' + (Date.now() + 1),
        from: 'AI Assistant',
        to: '+' + senderPhone,
        direction: 'outbound',
        text: aiReply,
        timestamp: new Date().toISOString()
      };
      db.messages.push(aiMsg);
      writeDB(db);
    } else {
      writeDB(db);
    }

    return aiReply;
  },

  // 2. Human outgoing message handler (Vikas himself typing)
  (chatPhone) => {
    // Record that Vikas is actively chatting with this person!
    humanActiveMap[chatPhone] = Date.now();
    console.log(`🛑 Muted AI bot for ${chatPhone} because Vikas is chatting.`);
  }
);

// -------------------------------------------------------------
// ROUTES: Dashboard & Data API
// -------------------------------------------------------------

app.get('/api/dashboard/stats', (req, res) => {
  const db = readDB();
  const totalCalls = db.calls.length;
  const missedCalls = db.calls.filter(c => c.status === 'missed' || c.status === 'no-answer').length;
  const voicemailsCount = db.voicemails.length;
  const totalMessages = db.messages.length;
  const waStatus = getWhatsAppStatus();

  res.json({
    stats: { totalCalls, missedCalls, voicemailsCount, totalMessages },
    calls: db.calls.slice(-10).reverse(),
    voicemails: db.voicemails.slice(-10).reverse(),
    messages: db.messages.slice(-20).reverse(),
    settings: {
      ownerName: db.settings.ownerName,
      ownerPhone: db.settings.ownerPhone || '9457886467',
      autoReplyText: db.settings.autoReplyText,
      hasGeminiKey: Boolean(db.settings.geminiApiKey || process.env.GEMINI_API_KEY)
    },
    whatsapp: waStatus
  });
});

app.get('/api/whatsapp/qr-status', (req, res) => {
  res.json(getWhatsAppStatus());
});

app.post('/api/settings', (req, res) => {
  const db = readDB();
  const { ownerName, ownerPhone, autoReplyText, geminiApiKey } = req.body;

  if (ownerName) db.settings.ownerName = ownerName;
  if (ownerPhone) db.settings.ownerPhone = ownerPhone;
  if (autoReplyText) db.settings.autoReplyText = autoReplyText;
  if (geminiApiKey !== undefined) db.settings.geminiApiKey = geminiApiKey;

  writeDB(db);
  res.json({ success: true, settings: db.settings });
});

// -------------------------------------------------------------
// ROUTES: Missed Call Webhook (Triggered by MacroDroid / Phone)
// -------------------------------------------------------------

// Cooldown to prevent multiple missed-call pings to the same person within 30 minutes
const lastMissedCallTime = {};

app.all(['/api/missed-call', '/api/simulate/missed-call'], async (req, res) => {
  let callerNumber = req.body?.callerNumber || req.query?.callerNumber || req.body?.from || '';
  const callerName = req.body?.callerName || req.query?.callerName || 'Caller';
  const callType = req.body?.callType || req.query?.callType || '';

  // CRITICAL FIX: If Vikas made an OUTGOING call to someone, DO NOT send auto-reply!
  if (callType && (callType.toLowerCase().includes('out') || callType.toLowerCase() === 'outgoing')) {
    console.log(`🚫 OUTGOING call to ${callerNumber} detected. Skipping auto-reply.`);
    return res.json({ success: false, reason: 'Outgoing call ignored' });
  }

  if (!callerNumber || callerNumber.includes('{call_number}')) {
    return res.status(400).json({ error: 'Invalid or missing caller number' });
  }

  // Clean caller number
  callerNumber = callerNumber.replace(/[^0-9+]/g, '');

  console.log(`⚡ MISSED CALL DETECTED from: ${callerNumber}`);

  const now = Date.now();
  const lastTime = lastMissedCallTime[callerNumber] || 0;

  // If we already sent a missed call auto-reply to this number in the last 15 minutes, don't spam
  if (now - lastTime < 15 * 60 * 1000) {
    console.log(`⏳ Cooldown active for ${callerNumber}. Skipping duplicate auto-ping.`);
    return res.json({ success: true, note: 'Cooldown active, skipped duplicate message' });
  }

  lastMissedCallTime[callerNumber] = now;
  // Reset bot reply count for new missed call session
  const cleanKey = callerNumber.replace(/[^0-9]/g, '');
  botReplyCount[cleanKey] = 0;
  delete humanActiveMap[cleanKey]; // Fresh missed call session

  const db = readDB();
  const newCall = {
    id: 'call_' + Date.now(),
    callerNumber: callerNumber,
    callerName: callerName,
    type: 'incoming',
    status: 'missed',
    timestamp: new Date().toISOString()
  };
  db.calls.push(newCall);

  const autoReplyText = db.settings.autoReplyText;
  const autoMsg = {
    id: 'msg_' + Date.now(),
    from: 'AI Assistant',
    to: callerNumber,
    direction: 'outbound',
    text: autoReplyText,
    timestamp: new Date().toISOString()
  };
  db.messages.push(autoMsg);
  writeDB(db);

  // Send real live WhatsApp message immediately to caller!
  const sentLive = await sendDirectWhatsApp(callerNumber, autoReplyText);

  res.json({
    success: true,
    message: 'Missed call logged and automated WhatsApp message dispatched!',
    sentLive: sentLive,
    call: newCall,
    autoWhatsApp: autoMsg
  });
});

app.post('/api/simulate/incoming-whatsapp', async (req, res) => {
  const { callerNumber, userMessage } = req.body;
  const number = callerNumber || '+91 9457886467';
  const text = userMessage || 'Hey, I called you regarding the quotation.';

  const db = readDB();

  const userMsg = {
    id: 'msg_' + Date.now(),
    from: number,
    to: 'AI Assistant',
    direction: 'inbound',
    text: text,
    timestamp: new Date().toISOString()
  };
  db.messages.push(userMsg);

  const aiReplyText = await generateAIResponse(number.replace(/[^0-9]/g, ''), text);

  if (aiReplyText) {
    const aiMsg = {
      id: 'msg_' + (Date.now() + 1),
      from: 'AI Assistant',
      to: number,
      direction: 'outbound',
      text: aiReplyText,
      timestamp: new Date().toISOString()
    };
    db.messages.push(aiMsg);
  }

  writeDB(db);

  res.json({
    success: true,
    userMessage: userMsg,
    aiReply: aiReplyText
  });
});

app.post('/api/simulate/voicemail', async (req, res) => {
  const { callerNumber, callerName, speechText } = req.body;
  const number = callerNumber || '+91 9457886467';
  const name = callerName || 'Rajesh Kumar';
  const transcript = speechText || "Hi Vikas, please call me back regarding clinic bot demo tomorrow morning.";

  const db = readDB();
  const isUrgent = transcript.toLowerCase().includes('urgent') || transcript.toLowerCase().includes('emergency');

  const voicemail = {
    id: 'vm_' + Date.now(),
    callerNumber: number,
    callerName: name,
    transcript: transcript,
    duration: '0:28',
    urgency: isUrgent ? 'High' : 'Normal',
    summary: isUrgent ? 'Urgent callback requested' : 'Inquiry regarding bot setup',
    timestamp: new Date().toISOString()
  };

  db.voicemails.push(voicemail);
  writeDB(db);

  res.json({
    success: true,
    message: 'Voicemail transcribed and saved!',
    voicemail: voicemail
  });
});

// -------------------------------------------------------------
// Live Interactive Voice Agent Call Engine (Pure Hindi & Clean English)
// -------------------------------------------------------------
app.post('/api/voice/live-call-turn', async (req, res) => {
  const { history = [], userSpeech = '', languageMode = 'auto' } = req.body;
  const db = readDB();
  const owner = db.settings.ownerName || 'Vikas';
  const apiKey = db.settings.geminiApiKey || process.env.GEMINI_API_KEY;

  // Language Detection: Hindi vs English
  const isHindiInput = /[\u0900-\u097F]/i.test(userSpeech) ||
    /(namaste|haan|mujhe|kya|kab|kaise|bhai|sahab|baat|shukriya|accha|karo|batao|naam|hai|hain)/i.test(userSpeech);

  const useHindi = languageMode === 'hi' || (languageMode === 'auto' && isHindiInput);

  if (apiKey) {
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

      const pastContext = history.map(h => `${h.role}: ${h.text}`).join('\n');
      const langInstruction = useHindi
        ? "Respond in pure, polite Hindi using Devanagari script (e.g. 'नमस्ते! मैंने नोट कर लिया है'). Never use English or Romanized Hindi."
        : "Respond in natural, professional English.";

      const prompt = `You are the polite, human-sounding personal phone assistant for ${owner}.
You are speaking directly over a live voice phone call in India.
${langInstruction}
Keep your spoken replies very short (1 to 2 sentences maximum) so it sounds natural on phone calls.
Find out the caller's name and why they are calling. Once you know their reason and name, tell them ${owner} will call back and wrap up warmly.

Call History:
${pastContext}
Caller just said: "${userSpeech}"

Your spoken reply:`;

      const result = await model.generateContent(prompt);
      const reply = (await result.response).text().trim();
      const shouldEnd = /(call back|have a great day|goodbye|संपर्क करेंगे|धन्यवाद|अलविदा|shukriya)/i.test(reply) && history.length >= 2;

      return res.json({ success: true, reply, lang: useHindi ? 'hi-IN' : 'en-IN', shouldEndCall: shouldEnd });
    } catch (err) {
      console.error('Gemini Voice error, using rule engine:', err.message);
    }
  }

  // Fallback Rule Engine with Pure Devanagari Hindi or Fluent English
  const lower = userSpeech.toLowerCase();
  let reply = '';
  let shouldEndCall = false;

  const isUrgent = /(urgent|emergency|jaldi|turant|abhibhi)/i.test(lower);
  const mentionsName = /(mera naam|my name is|i am|mai|me|this is)\s+([a-zA-Z\u0900-\u097F]+)/i.exec(userSpeech);
  const isGreeting = /^(hi|hello|hey|namaste|नमस्ते|haanji|haan)/i.test(lower);

  if (useHindi) {
    // Pure Devanagari Hindi for flawless natural pronunciation
    if (isUrgent) {
      reply = `जी ठीक है, मैंने समझ लिया कि यह बहुत ज़रूरी है। कृपया अपना नाम बता दीजिए, मैं ${owner} को तुरंत इमरजेंसी मैसेज भेजती हूँ।`;
    } else if (mentionsName || (history.length >= 2 && !isGreeting && lower.split(' ').length <= 3)) {
      const extractedName = mentionsName ? mentionsName[2] : userSpeech.trim();
      reply = `बहुत-बहुत धन्यवाद ${extractedName} जी! मैंने आपका मैसेज नोट कर लिया है। ${owner} आपसे जल्द ही कॉल करके बात करेंगे। आपका दिन शुभ हो!`;
      shouldEndCall = true;
    } else if (isGreeting && history.length <= 1) {
      reply = `नमस्ते! आपने ${owner} को कॉल किया है। ${owner} अभी व्यस्त हैं। आप कृपया बताएं किस काम के बारे में कॉल किया था?`;
    } else {
      reply = `जी ठीक है, मैंने नोट कर लिया है। क्या मैं आपका शुभ नाम जान सकती हूँ ताकि ${owner} को बता सकूँ?`;
    }
  } else {
    // Clean Fluent English
    if (isUrgent) {
      reply = `Understood, I've noted this is urgent. Please tell me your name so I can notify ${owner} right away.`;
    } else if (mentionsName || (history.length >= 2 && !isGreeting && lower.split(' ').length <= 3)) {
      const extractedName = mentionsName ? mentionsName[2] : userSpeech.trim();
      reply = `Thank you so much, ${extractedName}! I have taken down your message for ${owner}. He will call you back shortly. Have a wonderful day!`;
      shouldEndCall = true;
    } else if (isGreeting && history.length <= 1) {
      reply = `Hello! You've reached ${owner}'s assistant. ${owner} is currently in a meeting. May I know what this call is regarding?`;
    } else {
      reply = `Got it, I've noted your purpose. May I have your name so ${owner} knows who called?`;
    }
  }

  res.json({ success: true, reply, lang: useHindi ? 'hi-IN' : 'en-IN', shouldEndCall });
});

// Save completed voice call transcript to dashboard
app.post('/api/voice/save-call', (req, res) => {
  const { callerName = 'Live Voice Caller', callerNumber = '+91 9457886467', transcript = '', duration = '0:35' } = req.body;
  const db = readDB();

  const isUrgent = /(urgent|emergency|jaldi)/i.test(transcript);

  const callRecord = {
    id: 'call_' + Date.now(),
    callerNumber,
    callerName,
    type: 'incoming',
    status: 'completed',
    timestamp: new Date().toISOString()
  };
  db.calls.push(callRecord);

  const voicemailRecord = {
    id: 'vm_' + Date.now(),
    callerNumber,
    callerName,
    transcript,
    duration,
    urgency: isUrgent ? 'High' : 'Normal',
    summary: 'Live AI Voice Call completed',
    timestamp: new Date().toISOString()
  };
  db.voicemails.push(voicemailRecord);

  writeDB(db);
  res.json({ success: true, call: callRecord, voicemail: voicemailRecord });
});

// Start Server
app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🚀 AI Calling & Missed-Call Assistant Running!`);
  console.log(`📍 Web Dashboard: http://localhost:${PORT}`);
  console.log(`⚡ Missed Call Webhook: http://localhost:${PORT}/api/missed-call`);
  console.log(`===============================================`);
});
