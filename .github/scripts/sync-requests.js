// Reads request-format messages from Slack #berni and writes them to requests.json (encrypted).
// Runs from .github/workflows/sync-requests.yml on cron.
const fs = require('fs');
const crypto = require('crypto');

const TOKEN = process.env.SLACK_BOT_TOKEN;
const PASSPHRASE = process.env.REQUESTS_PASSPHRASE;
const CHANNEL_ID = process.env.CHANNEL_ID;
const REQUESTS_FILE = 'requests.json';

if (!TOKEN || !PASSPHRASE || !CHANNEL_ID) {
  console.error('Missing required env vars: SLACK_BOT_TOKEN, REQUESTS_PASSPHRASE, CHANNEL_ID');
  process.exit(1);
}

async function slackApi(method, params) {
  const url = `https://slack.com/api/${method}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${TOKEN}` } });
  const data = await res.json();
  return data;
}

// Strip Slack markdown wrappers and trim
function cleanField(s) {
  if (!s) return '';
  return s
    .replace(/<@U[A-Z0-9]+>/g, '')        // strip stray bot/user mentions
    .replace(/[*_]+/g, '')                 // strip bold/italic markers
    .replace(/[ \t]+\n/g, '\n')           // trailing spaces on lines
    .replace(/\n{3,}/g, '\n\n')           // collapse blank lines
    .trim();
}

// Parse a Slack message text against the request template.
// Returns { subject, submittedById, proposedByIds, privacyLevel, extraComments } or null.
function parseRequest(text) {
  if (!text || !text.includes('Se ha añadido una nueva request')) return null;
  // Normalise + strip the "Sent using <@bot>" footer some integrations add
  let t = text.replace(/\r\n/g, '\n');
  t = t.replace(/\*?\s*Sent using\s*\*?\s*<@[^>]+>\s*$/m, '').trimEnd();

  const byMatch = t.match(/Por:\s*<@(U[A-Z0-9]+)>/);
  const submittedById = byMatch ? byMatch[1] : null;

  const subjectMatch = t.match(/Subject:\s*([\s\S]*?)\s*Proposed By/);
  const subject = cleanField(subjectMatch ? subjectMatch[1] : '');

  const proposedByMatch = t.match(/Proposed By\.\.\.\s*([\s\S]*?)(?=Select the Privacy)/);
  const proposedByIds = [];
  if (proposedByMatch) {
    const re = /<@(U[A-Z0-9]+)>/g;
    let m;
    while ((m = re.exec(proposedByMatch[1])) !== null) proposedByIds.push(m[1]);
  }

  const privacyMatch = t.match(/Privacy Level\s*=\s*\*?\s*(\w+)\s*\*?/);
  const privacyLevel = privacyMatch ? privacyMatch[1] : null;

  const commentsMatch = t.match(/Extra Comments:\s*([\s\S]*?)$/);
  const extraComments = cleanField(commentsMatch ? commentsMatch[1] : '');

  if (!subject) return null;
  return { subject, submittedById, proposedByIds, privacyLevel, extraComments };
}

// Walk Slack message blocks to collect any text we can find (rich_text blocks etc.)
function flattenBlockText(blocks) {
  const out = [];
  function walk(node) {
    if (!node) return;
    if (typeof node.text === 'string') out.push(node.text);
    if (node.text && typeof node.text === 'object' && typeof node.text.text === 'string') out.push(node.text.text);
    if (Array.isArray(node.elements)) node.elements.forEach(walk);
    if (Array.isArray(node.fields)) node.fields.forEach(walk);
    if (Array.isArray(node)) node.forEach(walk);
  }
  if (Array.isArray(blocks)) blocks.forEach(walk);
  return out.join('\n');
}

function encrypt(plaintext, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: true,
    v: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64')
  };
}

function decrypt(payload, passphrase) {
  const salt = Buffer.from(payload.salt, 'base64');
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const ct = Buffer.from(payload.ct, 'base64');
  const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

(async () => {
  // Load existing
  let store = { _meta: { lastSeenTs: '0', syncedAt: null }, items: [] };
  if (fs.existsSync(REQUESTS_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(REQUESTS_FILE, 'utf8'));
      if (raw && raw.encrypted) {
        try {
          store = JSON.parse(decrypt(raw, PASSPHRASE));
        } catch (e) {
          console.error('Could not decrypt existing requests.json (passphrase changed?). Starting fresh.');
        }
      } else if (Array.isArray(raw)) {
        // legacy: empty array → keep default store
      } else if (raw && raw._meta) {
        store = raw;
      }
    } catch (e) {
      console.error('Could not parse existing requests.json:', e.message);
    }
  }

  // FORCE_REPARSE=1 to re-read everything from scratch (used after parser changes)
  const FORCE_REPARSE = process.env.FORCE_REPARSE === '1';
  if (FORCE_REPARSE) {
    console.log('FORCE_REPARSE=1 — re-reading channel from scratch and rebuilding the store.');
    store.items = [];
    store._meta.lastSeenTs = '0';
  }
  const knownTs = new Set(store.items.map(r => r.ts));

  // Fetch messages newer than lastSeenTs
  const oldest = store._meta.lastSeenTs || '0';
  const data = await slackApi('conversations.history', {
    channel: CHANNEL_ID,
    oldest,
    limit: 200,
    inclusive: 'false'
  });

  if (!data.ok) {
    if (data.error === 'not_in_channel') {
      console.log('Bot is not yet in the channel. Skip silently. Invite the bot with /invite @Berni Navigator Sync inside #berni.');
      return;  // exit 0 so workflow does not fail forever
    }
    console.error('Slack API error:', data.error);
    process.exit(1);
  }

  const newItems = [];
  let maxTs = parseFloat(oldest) || 0;
  for (const msg of (data.messages || [])) {
    const ts = msg.ts;
    if (parseFloat(ts) > maxTs) maxTs = parseFloat(ts);
    if (knownTs.has(ts)) continue;
    // Prefer plain text (already includes mentions). Only fall back to blocks when text is empty.
    let text = msg.text || '';
    if (!text || text.length < 30) text = flattenBlockText(msg.blocks || []);
    const parsed = parseRequest(text);
    if (!parsed) continue;
    let permalink = '';
    try {
      const pl = await slackApi('chat.getPermalink', { channel: CHANNEL_ID, message_ts: ts });
      if (pl.ok) permalink = pl.permalink;
    } catch (_) {}
    newItems.push({
      ts,
      channel: CHANNEL_ID,
      permalink,
      submittedAt: new Date(parseFloat(ts) * 1000).toISOString(),
      ...parsed
    });
  }

  if (newItems.length > 0) {
    console.log(`Found ${newItems.length} new request(s).`);
    store.items = [...store.items, ...newItems].sort((a, b) => parseFloat(b.ts) - parseFloat(a.ts));
  } else {
    console.log('No new requests.');
  }
  store._meta.lastSeenTs = String(maxTs);
  store._meta.syncedAt = new Date().toISOString();

  const encrypted = encrypt(JSON.stringify(store), PASSPHRASE);
  fs.writeFileSync(REQUESTS_FILE, JSON.stringify(encrypted, null, 2));
  console.log(`Wrote ${REQUESTS_FILE} (${store.items.length} total items).`);
})();
