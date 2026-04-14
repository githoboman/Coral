# Wallet API Usage Guide

This guide explains how to use the wallet balance and payment intent endpoints for sister apps.

## 1. Authentication
The server uses the existing authentication system. Requests must include the `auth_token` cookie from the main Tovira login.

- Base URL: `https://api.tovira.app/api` (or your local/staging equivalent)

## 2. Get Wallet Balance
Fetch the user's real-time on-chain portfolio.

**Endpoint:** `GET /wallet/balance`

### Example Response (200 OK)
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
          "name": "Sui",
          "balance": "10.5",
          "price_usd": 0.8875,
          "value_usd": 9.32
        }
      ],
      "total_value_usd": 9.32
    }
  ]
}
```

## 3. Create Charge Intent
Check a user's balance and get the data needed to trigger a payment.

**Endpoint:** `POST /wallet/charge`

### Request Body
```json
{
  "coin_type": "0x2::sui::SUI",
  "amount": "1.5",
  "reason": "Premium Feature"
}
```

### Example Response (200 OK)
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

### Error: Insufficient Balance (402)
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

## 4. Frontend Implementation (Sui SDK)
Once you receive the `payment_intent` from the server, use this logic in your frontend to execute the charge:

```typescript
import { Transaction } from "@mysten/sui/transactions";

async function executeCharge(paymentIntent) {
  const tx = new Transaction();
  
  // 1. Split the coins to the exact amount
  const [coin] = tx.splitCoins(tx.gas, [paymentIntent.amount_mist]);
  
  // 2. Transfer to the treasury
  tx.transferObjects([coin], paymentIntent.recipient);
  
  // 3. User signs and executes
  const result = await signAndExecuteTransaction({ transaction: tx });
  return result;
}
```
