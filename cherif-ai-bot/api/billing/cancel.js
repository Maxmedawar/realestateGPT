import { stripe, ensureCustomer } from "./_stripe.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const uid = req.headers["x-user-id"];
  const email = req.headers["x-user-email"] || undefined;
  if (!uid) return res.status(401).json({ detail: "Login required" });

  try {
    const customerId = await ensureCustomer(uid, email);
    const subs = await stripe.subscriptions.list({ customer: customerId, status: "active", limit: 1 });
    if (subs.data.length) {
      await stripe.subscriptions.update(subs.data[0].id, { cancel_at_period_end: true });
    }
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ detail: e.message || String(e) });
  }
}
