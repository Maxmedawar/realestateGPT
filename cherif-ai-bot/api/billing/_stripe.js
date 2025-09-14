import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20"
});

export async function ensureCustomer(uid, email) {
  if (email) {
    try {
      const found = await stripe.customers.search({ query: `email:'${email}'`, limit: 1 });
      if (found.data[0]) return found.data[0].id;
    } catch {}
  }
  const c = await stripe.customers.create({ email: email || undefined, metadata: { uid } });
  return c.id;
}

export function planFromSubscription(sub) {
  const active = ["trialing", "active", "past_due"].includes(sub?.status);
  return { plan: active ? "pro" : "none", active };
}

export const PRICE_ID = process.env.STRIPE_PRICE_ID || 'price_1S6R8fBIDiLt4lkLXgs2mljo';
