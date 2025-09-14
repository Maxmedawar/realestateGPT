import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' });

export default async function handler(req, res){
  if(req.method !== 'POST'){
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try{
    const userId = req.headers['x-user-id'];
    const userEmail = req.headers['x-user-email'];
    if(!userId) throw new Error('Missing user header');

    // Price ID (forced override per request)
    const priceId = process.env.STRIPE_PRICE_ID || 'price_1S6R8fBIDiLt4lkLXgs2mljo';

    const price = await stripe.prices.retrieve(priceId);
    if(!price.active) throw new Error('Price not active in Stripe dashboard');

    if(!price.unit_amount || !price.currency){
      throw new Error('Price missing amount or currency');
    }

    // Create one-off PaymentIntent (later /billing/activate will mark plan)
    const intent = await stripe.paymentIntents.create({
      amount: price.unit_amount,
      currency: price.currency,
      metadata: {
        price_id: priceId,
        user_id: userId,
        user_email: userEmail || ''
      },
      receipt_email: userEmail || undefined,
      description: 'Real Estate GPT – Pro Monthly',
      automatic_payment_methods: { enabled: true }
    });

    return res.status(200).json({
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id
    });
  }catch(err){
    console.error('subscribe error', err);
    return res.status(400).json({ error: err.message });
  }
}
