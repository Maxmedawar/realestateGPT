// index.js
// minimal Stripe webhook server + Firebase plan updates

const express = require("express");
const dotenv = require("dotenv");
const admin = require("firebase-admin");
const Stripe = require("stripe");

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// init Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});
const db = admin.firestore();

const app = express();

/**
 * IMPORTANT: the webhook route must use raw body
 * do not put express.json() before this route
 */
app.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("signature verify failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // idempotency: ignore if we processed this event already
    try {
      const seen = await db.collection("stripe_events").doc(event.id).get();
      if (seen.exists) {
        return res.json({ received: true, duplicate: true });
      }
      await db.collection("stripe_events").doc(event.id).set({
        type: event.type,
        created: event.created,
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) {
      console.warn("event dedupe warn:", e);
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;
          const uid = session.client_reference_id || null;
          const customerId = session.customer || null;

          // expand to get price id and subscription id
          const full = await stripe.checkout.sessions.retrieve(session.id, {
            expand: ["line_items", "subscription"],
          });
          const priceId = full?.line_items?.data?.[0]?.price?.id || null;
          const subscriptionId =
            full?.subscription?.id || session.subscription || null;

          // map your Stripe Price IDs to plans
          const PRICE_TO_PLAN = {
            // replace with your real price IDs from Stripe
            // example:
            // "price_1ABCDEFxxxxx": "Pro",
            // "price_1GHIJKLxxxxx": "Investor+",
          };
          const plan = PRICE_TO_PLAN[priceId] || "Pro"; // default to Pro if you only sell one

          if (!uid) {
            console.warn("no client_reference_id, cannot set plan");
            break;
          }

          // store a reverse lookup so later events can find the uid
          if (customerId) {
            await db
              .collection("stripeCustomers")
              .doc(customerId)
              .set({ uid }, { merge: true });
          }

          await db.collection("users").doc(uid).set(
            {
              plan,
              stripe: {
                customerId,
                subscriptionId,
                lastCheckoutSessionId: session.id,
                priceId,
                status: "active",
              },
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );

          break;
        }

        case "customer.subscription.updated": {
          const sub = event.data.object;
          const customerId = sub.customer;
          const status = sub.status; // active, past_due, canceled, unpaid, trialing
          const priceId =
            sub.items?.data?.[0]?.price?.id || sub.plan?.id || null;

          // lookup uid
          const snap = await db.collection("stripeCustomers").doc(customerId).get();
          const uid = snap.exists ? snap.data().uid : null;
          if (!uid) break;

          // same price -> plan mapping as above
          const PRICE_TO_PLAN = {
            // fill with your price IDs
          };
          const plan =
            status === "active" || status === "trialing"
              ? PRICE_TO_PLAN[priceId] || "Pro"
              : "NONE";

          await db.collection("users").doc(uid).set(
            {
              plan,
              stripe: {
                customerId,
                subscriptionId: sub.id,
                priceId,
                status,
              },
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
              stripe: {
                customerId,
                subscriptionId: sub.id,
                status: "canceled",
              },
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          break;
        }

        case "invoice.payment_succeeded": {
          // keep as no-op, useful for metrics if you want
          break;
        }

        case "invoice.payment_failed": {
          // you could mark as past_due here if you want
          break;
        }

        default:
          // ignore others
          break;
      }
    } catch (err) {
      console.error("handler error:", err);
      return res.status(500).send("server error");
    }

    res.json({ received: true });
  }
);

// after webhook route, now safe to use JSON parser for other endpoints
app.use(express.json());

app.get("/", (_req, res) => res.send("ok"));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`listening on :${port}`);
});
