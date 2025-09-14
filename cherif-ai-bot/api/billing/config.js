export default function handler(req, res) {
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PK || process.env.STRIPE_PUBLISHABLE_KEY || '';
  res.json({ publishableKey });
}
