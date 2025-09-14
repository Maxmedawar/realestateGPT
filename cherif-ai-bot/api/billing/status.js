import { stripe, ensureCustomer, planFromSubscription } from "./_stripe.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const uid = req.headers["x-user-id"];
  const email = req.headers["x-user-email"] || undefined;
  if (!uid) return res.status(401).json({ detail: "Missing X-User-Id" });

  try {
    const customerId = await ensureCustomer(uid, email);
    const cust = await stripe.customers.retrieve(customerId);

    // Price info
    let priceInfo = null;
    if (process.env.STRIPE_PRICE_ID) {
      const price = await stripe.prices.retrieve(process.env.STRIPE_PRICE_ID);
      priceInfo = {
        id: price.id,
        unit_amount: price.unit_amount,
        currency: price.currency,
        interval: price.recurring?.interval
      };
    }

    // Default payment method
    let pmInfo = null;
    let pmId = cust?.invoice_settings?.default_payment_method || null;
    if (!pmId) {
      const pms = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
      pmId = pms.data[0]?.id || null;
    }
    if (pmId) {
      const pm = await stripe.paymentMethods.retrieve(pmId);
      const c = pm.card;
      pmInfo = { brand: c.brand, last4: c.last4, exp_month: c.exp_month, exp_year: c.exp_year };
    }

    // Subscription summary
    const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 1 });
    const sub = subs.data[0] || null;

    let plan = "none", active = false, renews_at = null;
    if (sub) {
      ({ plan, active } = planFromSubscription(sub));
      if (active && !sub.cancel_at_period_end) renews_at = sub.current_period_end;
    }

    return res.json({
      customer_id: customerId,
      email: cust?.email || email || null,
      plan, active, renews_at,
      default_payment_method: pmInfo,
      price: priceInfo
    });
  } catch (e) {
    return res.status(500).json({ detail: e.message || String(e) });
  }
}
