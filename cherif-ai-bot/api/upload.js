// pages/api/upload.js
import Busboy from 'busboy';
import crypto from 'crypto';
import admin from 'firebase-admin';

// ⛔ Next.js must not parse the body for multipart
export const config = { api: { bodyParser: false } };

// ── Firebase Admin init (expects FIREBASE_ADMIN_JSON)
if (!admin.apps.length) {
  const raw = process.env.FIREBASE_ADMIN_JSON;
  if (!raw) throw new Error('Missing FIREBASE_ADMIN_JSON');
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(raw)),
  });
}
const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const ct = req.headers['content-type'] || '';
  if (!ct.includes('multipart/form-data')) {
    return res.status(400).json({ detail: 'Expected multipart/form-data' });
  }

  const uid = req.headers['x-user-id'];
  const chatId = req.headers['x-chat-id'] || 'default';
  if (!uid) return res.status(401).json({ error: 'Missing user' });

  try {
    const files = [];
    // stream/collect file metadata
    await new Promise((resolve, reject) => {
      const bb = Busboy({ headers: req.headers, limits: { files: 10 } });

      bb.on('file', (_name, file, info) => {
        const { filename, mimeType } = info;
        let size = 0;

        // drain stream (we’re not storing bytes here; just metadata)
        file.on('data', (chunk) => { size += chunk.length; });
        file.on('limit', () => reject(new Error('File too large')));
        file.on('end', () => {
          files.push({
            id: crypto.randomUUID(),
            name: filename || 'unnamed',
            type: mimeType || 'application/octet-stream',
            size,
          });
        });
      });

      bb.on('error', reject);
      bb.on('finish', resolve);
      req.pipe(bb);
    });

    // write metadata to Firestore
    const batch = db.batch();
    const colRef = db
      .collection('users').doc(uid)
      .collection('chats').doc(chatId)
      .collection('uploads');

    for (const f of files) {
      const docRef = colRef.doc(); // auto id
      batch.set(docRef, {
        name: f.name,
        size: f.size,
        type: f.type,
        uploaded_at: admin.firestore.FieldValue.serverTimestamp(),
        client_id: f.id,
      });
    }
    if (files.length) await batch.commit();

    return res.status(200).json({ files });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ detail: e.message || String(e) });
  }
}
