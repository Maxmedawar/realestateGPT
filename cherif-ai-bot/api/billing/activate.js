import Stripe from "stripe";
import admin from "firebase-admin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

function buildAdminCred() {
  if (process.env.FIREBASE_ADMIN_JSON) return JSON.parse(process.env.FIREBASE_ADMIN_JSON);
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  return {
    project_id: FIREBASE_PROJECT_ID,
    client_email: FIREBASE_CLIENT_EMAIL,
    private_key: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  };
}
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(buildAdminCred()) });
}
const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { paymentIntentId } = req.body || {};
    const uid = req.headers["x-user-id"];
    if (!uid) return res.status(401).json({ error: "Missing user id" });
    if (!paymentIntentId) return res.status(400).json({ error: "Missing paymentIntentId" });

    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status !== 'succeeded') {
      return res.status(400).json({ error: "Payment not completed" });
    }
    if (pi.metadata?.uid !== uid) {
      return res.status(403).json({ error: "User mismatch" });
    }

    await db.collection('users').doc(uid).set({
      plan: 'PRO',
      plan_activated_at: admin.firestore.FieldValue.serverTimestamp(),
      quota: 999999
    }, { merge: true });

    return res.json({ ok: true, plan: 'PRO' });
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Activate failed' });
  }
}