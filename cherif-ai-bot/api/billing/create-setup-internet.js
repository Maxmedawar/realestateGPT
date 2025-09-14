import { stripe, ensureCustomer } from "./_stripe.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const uid = req.headers["x-user-id"];
  const email = req.headers["x-user-email"] || undefined;
  if (!uid) return res.status(401).json({ detail: "Login required" });

  try {
    const customerId = await ensureCustomer(uid, email);
    const si = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
      usage: "off_session"
    });
    return res.json({ client_secret: si.client_secret, customer_id: customerId });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ detail: e.message || String(e) });
  }
}
