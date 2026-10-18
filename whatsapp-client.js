const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

let sock = null;
let currentQR = null;
let isConnected = false;
let connectedUser = null;
let onMessageCallback = null;
let onHumanSentMessage = null;

const authPath = path.join(__dirname, 'data', 'auth_info_baileys');
if (!fs.existsSync(authPath)) {
  fs.mkdirSync(authPath, { recursive: true });
}

async function startWhatsAppBot(messageHandler, humanMessageHandler) {
  onMessageCallback = messageHandler;
  onHumanSentMessage = humanMessageHandler;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      auth: state,
      printQRInTerminal: false,
      browser: ['Vikas AI Assistant', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('⚡ New WhatsApp QR Code generated!');
        try {
          currentQR = await QRCode.toDataURL(qr);
        } catch (err) {
          console.error('Failed to convert QR to image:', err);
        }
      }

      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('WhatsApp connection closed, reconnecting:', shouldReconnect);
        isConnected = false;
        connectedUser = null;
        if (shouldReconnect) {
          setTimeout(() => startWhatsAppBot(onMessageCallback, onHumanSentMessage), 3000);
        }
      } else if (connection === 'open') {
        console.log('✅ WhatsApp successfully connected!');
        isConnected = true;
        currentQR = null;
        connectedUser = sock.user?.id || 'Connected';
      }
    });

    // Handle incoming & outgoing messages
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message) continue;
        const remoteJid = msg.key.remoteJid;

        // Ignore status broadcasts, group chats, or newsletters
        if (!remoteJid || remoteJid.includes('@broadcast') || remoteJid.includes('@g.us') || remoteJid.includes('@newsletter')) {
          continue;
        }

        const senderPhone = remoteJid.split('@')[0];

        // CRITICAL RULE: If VIKAS himself sent a message, MUTE the bot immediately!
        if (msg.key.fromMe) {
          console.log(`👤 Human (Vikas) is actively chatting with ${senderPhone}. Muting AI for this chat.`);
          if (onHumanSentMessage) {
            onHumanSentMessage(senderPhone);
          }
          continue;
        }

        const messageText = msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption || '';

        if (!messageText.trim()) continue;

        console.log(`📩 Incoming WhatsApp from ${senderPhone}: ${messageText}`);

        if (onMessageCallback) {
          const aiReply = await onMessageCallback(senderPhone, messageText);
          if (aiReply) {
            await sock.sendMessage(remoteJid, { text: aiReply });
            console.log(`🤖 AI Replied to ${senderPhone}: ${aiReply}`);
          } else {
            console.log(`🤫 AI staying silent for ${senderPhone} (Filler word or Human active)`);
          }
        }
      }
    });

  } catch (err) {
    console.error('Error starting WhatsApp client:', err);
  }
}

// Send outbound message (e.g. for missed call auto-reply)
async function sendDirectWhatsApp(phone, text) {
  if (!sock || !isConnected) {
    console.log('WhatsApp not connected yet. Cannot send message to:', phone);
    return false;
  }

  // Clean phone number: remove +, spaces, dashes
  let cleaned = phone.replace(/[^0-9]/g, '');
  // If Indian 10-digit number without country code, prepend 91
  if (cleaned.length === 10) {
    cleaned = '91' + cleaned;
  }

  const jid = `${cleaned}@s.whatsapp.net`;
  try {
    await sock.sendMessage(jid, { text });
    console.log(`✅ Sent WhatsApp message to ${jid}`);
    return true;
  } catch (err) {
    console.error(`Failed to send WhatsApp message to ${jid}:`, err.message);
    return false;
  }
}

function getWhatsAppStatus() {
  return {
    isConnected,
    connectedUser,
    qrCode: currentQR
  };
}

module.exports = {
  startWhatsAppBot,
  sendDirectWhatsApp,
  getWhatsAppStatus
};
