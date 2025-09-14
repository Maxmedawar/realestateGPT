// cherif-ai-bot/api/ask.js

import admin from 'firebase-admin';
import { OpenAI } from 'openai';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

import mammoth from 'mammoth';
import stream from 'node:stream';

// ─────────────────────────────────────────────────────────────
// Firebase Admin (service account via env)
// ─────────────────────────────────────────────────────────────
function buildAdminCred() {
  if (process.env.FIREBASE_ADMIN_JSON) {
    try {
      return JSON.parse(process.env.FIREBASE_ADMIN_JSON);
    } catch {
      throw new Error('FIREBASE_ADMIN_JSON is not valid JSON');
    }
  }
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing Firebase admin credentials');
  }
  privateKey = privateKey.includes('\\n') ? privateKey.replace(/\\n/g, '\n') : privateKey;
  return { project_id: projectId, client_email: clientEmail, private_key: privateKey };
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(buildAdminCred()) });
}

const db = admin.firestore();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const FREE_WEEKLY_LIMIT = parseInt(process.env.FREE_WEEKLY_LIMIT || '3', 10);

// ─────────────────────────────────────────────────────────────
// S3 (optional; used when file metadata includes an s3Key)
// ─────────────────────────────────────────────────────────────
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials:
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
});
const S3_BUCKET = process.env.S3_BUCKET;

async function getS3ObjectBuffer(Key) {
  const data = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key }));
  // Node.js runtime: Body is a readable stream
  const chunks = [];
  const body = data.Body;

  if (body && typeof body.pipe === 'function') {
    const pass = new stream.PassThrough();
    body.pipe(pass);
    for await (const chunk of pass) chunks.push(chunk);
  } else if (body && Symbol.asyncIterator in Object(body)) {
    for await (const chunk of body) chunks.push(chunk);
  } else if (body?.transformToByteArray) {
    const arr = await body.transformToByteArray();
    return Buffer.from(arr);
  }
  return Buffer.concat(chunks);
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function getResetDate() {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + 7);
  return now;
}

// ─────────────────────────────────────────────────────────────
// API Route
// ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const uid = req.headers['x-user-id'];
  if (!uid) return res.status(401).json({ error: 'Missing user' });

  try {
    // Load user quota/plan
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    let { plan = 'NONE', quota = FREE_WEEKLY_LIMIT, quota_reset_at } = userDoc.exists ? userDoc.data() : {};

    let resetAt = quota_reset_at
      ? quota_reset_at.toDate
        ? quota_reset_at.toDate()
        : new Date(quota_reset_at)
      : null;

    if (!resetAt || resetAt < new Date()) {
      quota = FREE_WEEKLY_LIMIT;
      resetAt = getResetDate();
      await userRef.set({ quota, quota_reset_at: resetAt }, { merge: true });
    }

    if (plan === 'NONE' && quota <= 0) {
      return res.status(402).json({ error: 'Free Weekly Limit Reached', resetAt });
    }

    const { question, chatId, files } = req.body || {};
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'No question' });
    }

    // ── Optional: gather context from up to 3 files in S3 ───────────
    let fileTextSummary = '';
    if (Array.isArray(files) && files.length > 0 && S3_BUCKET) {
      for (const fileMeta of files.slice(0, 3)) {
        let fileText = '';
        const fileTitle = fileMeta?.name || fileMeta?.filename || 'Untitled';
        const s3Key =
          fileMeta?.s3Key || fileMeta?.key || fileMeta?.path || fileTitle;

        try {
          const ext = (fileMeta?.ext || fileTitle.split('.').pop() || '').toLowerCase();
          const buffer = await getS3ObjectBuffer(s3Key);

          if (ext === 'txt') {
            fileText = buffer.toString('utf8').slice(0, 4000);
          } else if (ext === 'pdf') {
            const { default: pdfParse } = await import('pdf-parse');
            const pdf = await pdfParse(buffer);
            fileText = (pdf.text || '').slice(0, 4000);
          } else if (ext === 'docx' || ext === 'doc') {
            const result = await mammoth.extractRawText({ buffer });
            fileText = (result.value || '').slice(0, 4000);
          } else {
            fileText = '[File type not supported for reading]';
          }
        } catch (e) {
          console.error('File read error:', e);
          fileText = `[Error reading file or file not found in S3: ${e?.message || e}]`;
        }

        fileTextSummary += `\n---\nFile: ${fileTitle}\n${fileText}\n`;
      }
    }

    // ── Call OpenAI ────────────────────────────────────────────────
    let answer = '';
    const prompt = fileTextSummary
      ? `The user has attached the following files. Use their content to answer the question.\n${fileTextSummary}\nQuestion: ${question}`
      : question;

    try {
      const resp = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are Real Estate GPT.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.4,
      });
      answer = resp.choices?.[0]?.message?.content || '';
    } catch (e) {
      console.error('OpenAI error:', e);
      return res.status(500).json({ error: 'OpenAI error', detail: String(e) });
    }

    // Decrement quota only on success for free users
    if (plan === 'NONE') {
      await userRef.set({ quota: quota - 1 }, { merge: true });
    }

    // Save chat
    const chatTitle = question.length > 35 ? question.slice(0, 35) + '…' : question;
    let chatDocId = chatId;

    if (!chatDocId) {
      const chatDoc = await userRef.collection('chats').add({
        title: chatTitle,
        html: '',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      chatDocId = chatDoc.id;
    }

    const chatRef = userRef.collection('chats').doc(chatDocId);
    await chatRef.set(
      {
        title: chatTitle,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        messages: admin.firestore.FieldValue.arrayUnion(
          { role: 'user', content: question, ts: new Date() },
          { role: 'assistant', content: answer, ts: new Date() }
        ),
      },
      { merge: true }
    );

    return res.json({
      answer,
      quota: plan === 'NONE' ? quota - 1 : '∞',
      resetAt,
      chatId: chatDocId,
    });
  } catch (err) {
    console.error('ask.js error:', err);
    return res.status(500).json({ error: 'Server error', detail: String(err) });
  }
}
