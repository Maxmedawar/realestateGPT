// index.js — Stripe webhook + Firebase plan updates
import express from "express";
import dotenv from "dotenv";
import admin from "firebase-admin";
import Stripe from "stripe";

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// ── Firebase Admin creds: from FIREBASE_ADMIN_JSON or 3 separate envs ──
let adminCred;
if (process.env.FIREBASE_ADMIN_JSON) {
  adminCred = JSON.parse(process.env.FIREBASE_ADMIN_JSON);
} else {
  adminCred = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  };
}
admin.initializeApp({ credential: admin.credential.cert(adminCred) });
const db = admin.firestore();

const app = express();

// Stripe needs raw body here
app.post("/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("signature verify failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // de-dupe
  try {
    const seen = await db.collection("stripe_events").doc(event.id).get();
    if (seen.exists) return res.json({ received: true, duplicate: true });
    await db.collection("stripe_events").doc(event.id).set({
      type: event.type,
      created: event.created,
      receivedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch {}

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        const uid = s.client_reference_id || null;
        const customerId = s.customer || null;
        const full = await stripe.checkout.sessions.retrieve(s.id, { expand: ["line_items", "subscription"] });
        const priceId = full?.line_items?.data?.[0]?.price?.id || null;
        const subscriptionId = full?.subscription?.id || s.subscription || null;

        // map Stripe price → your plan
        const PRICE_TO_PLAN = {
          // "price_XXXX": "Pro",
          // "price_YYYY": "Investor+",
        };
        const plan = PRICE_TO_PLAN[priceId] || "Pro";

        if (customerId) await db.collection("stripeCustomers").doc(customerId).set({ uid }, { merge: true });
        if (uid) {
          await db.collection("users").doc(uid).set(
            {
              plan,
              stripe: { customerId, subscriptionId, priceId, status: "active", lastCheckoutSessionId: s.id },
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
        break;
      }
      case "customer.subscription.updated": {
        const sub = event.data.object;
        const priceId = sub.items?.data?.[0]?.price?.id || sub.plan?.id || null;
        const status = sub.status;
        const customerId = sub.customer;

        const snap = await db.collection("stripeCustomers").doc(customerId).get();
        const uid = snap.exists ? snap.data().uid : null;
        if (!uid) break;

        const PRICE_TO_PLAN = {};
        const plan = (status === "active" || status === "trialing") ? (PRICE_TO_PLAN[priceId] || "Pro") : "NONE";

        await db.collection("users").doc(uid).set(
          {
            plan,
            stripe: { customerId, subscriptionId: sub.id, priceId, status },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const customerId = sub.customer;
        const snap = await db.collection("stripeCustomers").doc(customerId).get();
        const uid = snap.exists ? snap.data().uid : null;
        if (!uid) break;

        await db.collection("users").doc(uid).set(
          {
            plan: "NONE",
            stripe: { customerId, subscriptionId: sub.id, status: "canceled" },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        break;
      }
      default: break;
    }
  } catch (err) {
    console.error("handler error:", err);
    return res.status(500).send("server error");
  }

  res.json({ received: true });
});

// JSON parser AFTER webhook
app.use(express.json());
app.get("/", (_req, res) => res.send("ok"));
app.listen(process.env.PORT || 3000, () => console.log("listening"));
