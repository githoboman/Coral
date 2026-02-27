import fetch from 'node-fetch';

const API_BASE = 'http://localhost:3000/api';
const WALLET = '0x' + 'd'.repeat(64); // Test wallet

async function test() {
  console.log('--- Testing Check-in Exploit Fix ---');

  try {
    // 1. Initial status in UTC
    console.log('\n[1] Checking status in UTC...');
    let res = await fetch(`${API_BASE}/checkin/status?wallet_address=${WALLET}&timezone_offset=0`);
    let status = await res.json();
    console.log(`Can check in: ${status.can_checkin}, Last date: ${status.last_checkin_date}`);

    // If already checked in, the following tests might fail to prove "blocking" if they were already blocked.
    // However, they will still prove that they stay blocked.

    // 2. Check in for "Today" in UTC+14 (Extreme future timezone)
    console.log('\n[2] Checking in for future date (UTC+14)...');
    res = await fetch(`${API_BASE}/checkin/request-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet_address: WALLET, timezone_offset: 840 })
    });
    let checkin1 = await res.json();
    console.log(`Success: ${checkin1.success}, Date: ${checkin1.checkin_date}`);

    const futureDate = checkin1.checkin_date;

    // 3. Try to check in for "Today" in UTC-12 (Extreme past timezone)
    console.log('\n[3] Attempting exploit: Check in for past date (UTC-12)...');
    res = await fetch(`${API_BASE}/checkin/request-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet_address: WALLET, timezone_offset: -720 })
    });
    let exploit1 = await res.json();
    console.log(`Success: ${exploit1.success}, Message: ${exploit1.message}`);

    if (exploit1.success) {
      console.error('❌ EXPLOIT FAILED: Allowed checking in for a past date after a future date!');
    } else {
      console.log('✅ Exploit blocked: Past date check-in rejected.');
    }

    // 4. Try to check in again for the SAME future date but different offset
    console.log('\n[4] Attempting exploit: Check in again for same calendar date but different offset...');
    res = await fetch(`${API_BASE}/checkin/request-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet_address: WALLET, timezone_offset: 839 }) 
    });
    let exploit2 = await res.json();
    console.log(`Success: ${exploit2.success}, Message: ${exploit2.message}`);

    if (exploit2.success) {
      console.error('❌ EXPLOIT FAILED: Allowed duplicate check-in for the same calendar date!');
    } else {
      console.log('✅ Exploit blocked: Duplicate date check-in rejected.');
    }

  } catch (err) {
    console.error('Test encountered an error:', err);
  }

  console.log('\n--- Test Completed ---');
}

test().catch(console.error);
