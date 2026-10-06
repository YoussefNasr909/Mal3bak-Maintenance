import 'dotenv/config';

/**
 * Connectivity check: verifies outbound HTTPS from this machine to Paymob's servers.
 * Tests:
 * 1. Paymob Intention API (Secret Key auth) — can we create intentions?
 * 2. Paymob Auth Token API (API Key auth) — can the Inquiry fallback work?
 */

const PAYMOB_BASE_URL = process.env.PAYMOB_BASE_URL || 'https://accept.paymob.com';
const SECRET_KEY = process.env.PAYMOB_SECRET_KEY;
const API_KEY = process.env.PAYMOB_API_KEY;

async function main() {
  console.log('\n🔌 === PAYMOB CONNECTIVITY CHECK ===\n');

  // Test 1: Auth Token API (used by Inquiry Fallback — critical for no-ngrok flow)
  console.log('Test 1: Paymob Auth Token API (API Key → short-lived token)...');
  try {
    const res = await fetch(`${PAYMOB_BASE_URL}/api/auth/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: API_KEY }),
    });
    if (res.ok) {
      const data = await res.json();
      console.log(`  ✅ PASS — Auth token obtained (${data.token?.substring(0, 20)}...)`);
    } else {
      const err = await res.text();
      console.log(`  ❌ FAIL — HTTP ${res.status}: ${err.substring(0, 200)}`);
    }
  } catch (e) {
    console.log(`  ❌ FAIL — Network error: ${e.message}`);
  }

  // Test 2: Intention API ping (Secret Key auth — used by createCheckoutSession)
  console.log('\nTest 2: Paymob Intention API (Secret Key auth)...');
  try {
    // We'll make a deliberately minimal request that will fail validation but prove connectivity & auth
    const res = await fetch(`${PAYMOB_BASE_URL}/v1/intention/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: 100,
        currency: 'EGP',
        payment_methods: [Number(process.env.PAYMOB_INTEGRATION_ID_CARD)],
        items: [{ name: 'Connectivity Test', amount: 100, quantity: 1 }],
        billing_data: {
          first_name: 'Test', last_name: 'Check', email: 'test@test.com',
          phone_number: '+201000000000', apartment: 'NA', floor: 'NA',
          street: 'NA', building: 'NA', shipping_method: 'NA',
          postal_code: 'NA', city: 'Cairo', country: 'EGY', state: 'Cairo',
        },
        special_reference: `connectivity_check_${Date.now()}`,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      console.log(`  ✅ PASS — Intention created successfully (id: ${data.id})`);
      console.log(`  ✅ PASS — client_secret starts with: ${data.client_secret?.substring(0, 25)}...`);
      console.log(`  ✅ PASS — Checkout URL would be: ${PAYMOB_BASE_URL}/unifiedcheckout/?publicKey=${process.env.PAYMOB_PUBLIC_KEY}&clientSecret=${data.client_secret?.substring(0, 15)}...`);
    } else {
      const err = await res.text();
      // A 400/422 means auth worked but payload was rejected — still proves connectivity
      if (res.status === 400 || res.status === 422) {
        console.log(`  ⚠️  Auth OK, but payload rejected (HTTP ${res.status}) — this is expected for a minimal test`);
      } else if (res.status === 401) {
        console.log(`  ❌ FAIL — 401 Unauthorized: Secret Key is invalid or expired`);
      } else {
        console.log(`  ❌ FAIL — HTTP ${res.status}: ${err.substring(0, 200)}`);
      }
    }
  } catch (e) {
    console.log(`  ❌ FAIL — Network error: ${e.message}`);
  }

  console.log('\n🔌 === CONNECTIVITY CHECK COMPLETE ===\n');
}

main().catch(e => { console.error(e); process.exit(1); });
