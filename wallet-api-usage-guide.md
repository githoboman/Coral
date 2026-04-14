# Wallet API

Here's everything you need to start charging users and reading their balances from your app. It's simpler than it looks.

---

## Auth

The app needs to be logged into Tovira. As long as the user has logged in through the main Tovira app, their `auth_token` cookie will be present and your requests will go through automatically.

Just make sure your API calls include credentials:

```typescript
fetch("<apiEndpoint>/api/wallet/balance", {
  credentials: "include" // This sends the cookie automatically
})
```

Although, you already know this.

---

## Check User's Balance

Want to know how much SUI (or any other token) a user has before charging them? Hit this endpoint first.

```typescript
GET <apiEndpoint>/api/wallet/balance
```

You'll get back something like:

```json
{
  "status": true,
  "message": "Balance fetched successfully",
  "data": [
    {
      "wallet_address": "0x6788...fd5c",
      "coins": [
        {
          "symbol": "SUI",
          "balance": "10.5",
          "value_usd": 9.32
        }
      ],
      "total_value_usd": 9.32
    }
  ]
}
```

Simple — `data[0].coins` is the list of assets, and everything is wrapped in a standard success object.

---

## Charge a User

When you're ready to charge, send a POST request with what you want to charge and why.

```
POST <apiEndpoint>/api/wallet/charge
```

```json
{
  "coin_type": "0x2::sui::SUI",
  "amount": "1.5",
  "reason": "Premium Feature"
}
```

The server checks if the user has enough balance. Two things can happen:

**They have enough — you get a payment intent back:**
```json
{
  "status": true,
  "message": "Payment intent created",
  "data": [
    {
      "payment_intent": {
        "recipient": "0xTREASURY_ADDRESS",
        "coin_type": "0x2::sui::SUI",
        "amount_mist": "1500000000",
        "reason": "Premium Feature",
        "expires_at": 1713028800
      }
    }
  ]
}
```

**They don't have enough — you get an error object:**
```json
{
  "status": false,
  "message": "Insufficient balance",
  "data": [],
  "errors": [
    {
      "code": "INSUFFICIENT_BALANCE",
      "required": "1.5",
      "available": "0.8",
      "coin_type": "0x2::sui::SUI"
    }
  ]
}
```

---

## Completing the Payment

The `payment_intent` you got back is not a charge yet — it's the instruction your frontend needs to ask the user to sign the transaction with their wallet. Pass it to this function:

```typescript
import { Transaction } from "@mysten/sui/transactions";

async function executeCharge(paymentIntent) {
  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.gas, [paymentIntent.amount_mist]);
  tx.transferObjects([coin], paymentIntent.recipient);
  const result = await signAndExecuteTransaction({ transaction: tx });
  return result;
}
```

The user's wallet will prompt them to confirm. Once they do, the payment goes through.

---

## Quick Reference

| What you want to do | Endpoint |
|---|---|
| Check user's balance | `GET /api/wallet/balance` |
| Request a charge | `POST /api/wallet/charge` |

**Base URL:** `<apiEndpoint>`

**Please Note:** Every response (success or error) uses the same structure. Successes have `status: true` and data in the `data` array. Errors have `status: false` and error details in the `errors` array.
