# Enable real QR Ph payments

The public payment configuration reports the current server mode at `/api/payment-config`. QR Ph is intentionally unavailable with test credentials. Never scan previously generated test QR codes with a real banking or wallet app.

1. In the merchant's PayMongo dashboard, complete account activation and confirm QR Ph is enabled for live payments.
2. In Vercel's **Production** environment variables, set `PAYMONGO_SECRET_KEY` to the merchant's live secret key (`sk_live_…`). Never paste the key into chat, frontend code, or Git.
3. Create or verify the **live-mode** PayMongo webhook for `https://ecopass-rose.vercel.app/api/paymongo/webhook`, subscribed to `checkout_session.payment.paid`. Set `PAYMONGO_WEBHOOK_SECRET` to that endpoint's signing secret in Vercel Production.
4. Redeploy the production app. Confirm `/api/payment-config` returns `mode: "live"` and `qrphAvailable: true`. These flags confirm local configuration, not merchant-channel activation.
5. Generate a fresh checkout. The owner should perform any real-money acceptance test, confirm the payment in PayMongo, and verify that EcoPass issues the visitor QR only after a valid signed payment confirmation.

If a fresh live QR is rejected, inspect the failed payment in PayMongo for its failure reason. The wallet's generic error screenshot is not enough to determine a provider decline. Do not repeatedly pay until transaction history and the merchant payment status have been checked.

PayMongo's QR Ph test guidance: https://docs.paymongo.com/docs/payment-acceptance-testing
