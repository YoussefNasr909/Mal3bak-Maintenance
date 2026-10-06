import crypto from "crypto";

const getPaymobBaseUrl = () => process.env.PAYMOB_BASE_URL || "https://accept.paymob.com";
const getPaymobSecretKey = () => process.env.PAYMOB_SECRET_KEY || "";
const getPaymobPublicKey = () => process.env.PAYMOB_PUBLIC_KEY || "";
// Environment control panels sometimes preserve accidental surrounding whitespace. Paymob HMAC
// secrets are opaque token values, so normalizing surrounding whitespace avoids a false negative
// without changing the configured secret itself.
const getPaymobHmacSecret = () => String(process.env.PAYMOB_HMAC_SECRET || "").trim();
const getPaymobApiKey = () => process.env.PAYMOB_API_KEY || "";
const getCardIntegrationId = () => Number(process.env.PAYMOB_INTEGRATION_ID_CARD) || 0;
const getWalletIntegrationId = () => Number(process.env.PAYMOB_INTEGRATION_ID_WALLET) || 0;
const getApplePayIntegrationId = () => Number(process.env.PAYMOB_INTEGRATION_ID_APPLE_PAY) || 0;
// A Paymob checkout must never remain valid far beyond the reservation window.  Keeping this
// bounded also ensures an abandoned hosted checkout eventually reaches a terminal provider state
// that the reconciliation worker can safely observe.
const DEFAULT_INTENTION_EXPIRATION_SECONDS = 15 * 60;

function requireIntegrationId(value, envName) {
  if (value) return value;
  const error = new Error(`${envName} is not configured in environment variables`);
  error.status = 503;
  error.definitive = true;
  throw error;
}

// Keep the frontend choice and the actual Paymob payment_methods payload in lockstep.  The old
// implementation always sent the card ID, even when the player chose Apple Pay or wallet.
function getUnifiedCheckoutIntegrationIds(paymentMethodType = "all") {
  const cardId = getCardIntegrationId();
  const walletId = getWalletIntegrationId();
  const applePayId = getApplePayIntegrationId();

  if (paymentMethodType === "card") {
    return [requireIntegrationId(cardId, "PAYMOB_INTEGRATION_ID_CARD")];
  }
  if (paymentMethodType === "wallet") {
    return [requireIntegrationId(walletId, "PAYMOB_INTEGRATION_ID_WALLET")];
  }
  if (paymentMethodType === "apple_pay") {
    return [requireIntegrationId(applePayId, "PAYMOB_INTEGRATION_ID_APPLE_PAY")];
  }

  // "all" means every configured live integration, with cards required as the baseline.
  requireIntegrationId(cardId, "PAYMOB_INTEGRATION_ID_CARD");
  return [...new Set([cardId, walletId, applePayId].filter(Boolean))];
}

/**
 * Creates a Paymob Payment Intention using POST /v1/intention/
 * Required Header: Authorization: Token <SECRET_KEY>
 */
export async function createPaymentIntention({
  amountCents,
  currency = "EGP",
  specialReference,
  customer,
  items = [],
  paymentMethodType = "all",
  notificationUrl,
  redirectionUrl,
  expirationSeconds = DEFAULT_INTENTION_EXPIRATION_SECONDS,
}) {
  const secretKey = getPaymobSecretKey();
  if (!secretKey) {
    throw new Error("PAYMOB_SECRET_KEY is not configured in environment variables");
  }

  const paymentMethods = getUnifiedCheckoutIntegrationIds(paymentMethodType);

  const payload = {
    amount: amountCents,
    currency,
    payment_methods: paymentMethods,
    items: items.map((item) => ({
      name: item.name || "Court Booking",
      amount: item.amount || amountCents,
      description: item.description || "Mal3bk Court Booking",
      quantity: item.quantity || 1,
    })),
    billing_data: {
      first_name: customer.firstName || "Player",
      last_name: customer.lastName || "User",
      email: customer.email || "player@mal3bk.com",
      phone_number: customer.phone || "+201000000000",
      apartment: "NA",
      floor: "NA",
      street: "NA",
      building: "NA",
      shipping_method: "NA",
      postal_code: "NA",
      city: "Cairo",
      country: "EGY",
      state: "Cairo",
    },
    customer: {
      first_name: customer.firstName || "Player",
      last_name: customer.lastName || "User",
      email: customer.email || "player@mal3bk.com",
    },
    special_reference: specialReference,
    expiration: Math.max(60, Math.floor(Number(expirationSeconds) || DEFAULT_INTENTION_EXPIRATION_SECONDS)),
    notification_url: notificationUrl || `${process.env.BACKEND_URL || "http://localhost:4000"}/api/v1/payments/webhook`,
    redirection_url: redirectionUrl || `${process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || "http://localhost:3000"}/payment/complete?booking_id=${specialReference}`,
  };

  const response = await fetch(`${getPaymobBaseUrl()}/v1/intention/`, {
    method: "POST",
    headers: {
      "Authorization": `Token ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMsg = errorData.detail || JSON.stringify(errorData) || `Paymob API returned status ${response.status}`;
    const error = new Error(`Paymob Intention Error: ${errorMsg}`);
    error.status = response.status;
    // A 4xx response is a confirmed rejection. A timeout, network error or 5xx can be ambiguous:
    // Paymob may have accepted the intention even though our process did not receive the result.
    error.definitive = response.status >= 400 && response.status < 500;
    throw error;
  }

  const data = await response.json();
  const publicKey = getPaymobPublicKey();
  // Use Paymob's Unified Checkout URL (shows all enabled payment methods: cards, wallets, etc.)
  const baseUrl = getPaymobBaseUrl(); // https://accept.paymob.com
  const checkoutUrl = `${baseUrl}/unifiedcheckout/?publicKey=${publicKey}&clientSecret=${data.client_secret}`;

  return {
    id: data.id,
    clientSecret: data.client_secret,
    checkoutUrl,
    paymobOrderId: data.intention_order_id || (data.order && data.order.id) || null,
  };
}

/**
 * Validates the HMAC-SHA512 signature of a Paymob Transaction Processed Callback.
 * Canonical order of 20 fields specified in Paymob documentation:
 * 1. amount_cents
 * 2. created_at
 * 3. currency
 * 4. error_occured
 * 5. has_parent_transaction
 * 6. id
 * 7. integration_id
 * 8. is_3d_secure
 * 9. is_auth
 * 10. is_capture
 * 11. is_refunded
 * 12. is_standalone_payment
 * 13. is_voided
 * 14. order.id
 * 15. owner
 * 16. pending
 * 17. source_data.pan
 * 18. source_data.sub_type
 * 19. source_data.type
 * 20. success
 */
export function verifyTransactionHmac(obj, receivedHmac) {
  const hmacSecret = getPaymobHmacSecret();
  if (!hmacSecret || !receivedHmac || !obj) {
    return false;
  }

  const fields = [
    obj.amount_cents,
    obj.created_at,
    obj.currency,
    obj.error_occured,
    obj.has_parent_transaction,
    obj.id,
    obj.integration_id,
    obj.is_3d_secure,
    obj.is_auth,
    obj.is_capture,
    obj.is_refunded,
    obj.is_standalone_payment,
    obj.is_voided,
    obj.order?.id,
    obj.owner,
    obj.pending,
    obj.source_data?.pan,
    obj.source_data?.sub_type,
    obj.source_data?.type,
    obj.success,
  ];

  const concatenatedString = fields.map((val) => (val !== undefined && val !== null ? String(val) : "")).join("");
  const computedHmac = crypto
    .createHmac("sha512", hmacSecret)
    .update(concatenatedString)
    .digest("hex")
    .toLowerCase();

  const receivedHmacLower = String(receivedHmac).toLowerCase();

  if (computedHmac.length !== receivedHmacLower.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(computedHmac), Buffer.from(receivedHmacLower));
}

/**
 * Refund a Paymob Transaction
 * POST /api/acceptance/void_refund/refund
 */
export async function refundTransaction({ transactionId, amountCents }) {
  const secretKey = getPaymobSecretKey();
  if (!secretKey) {
    throw new Error("PAYMOB_SECRET_KEY is not configured");
  }

  const response = await fetch(`${getPaymobBaseUrl()}/api/acceptance/void_refund/refund`, {
    method: "POST",
    headers: {
      "Authorization": `Token ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transaction_id: String(transactionId),
      amount_cents: String(amountCents),
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(`Refund failed: ${errData.message || JSON.stringify(errData)}`);
  }

  return await response.json();
}

/**
 * Transaction Inquiry (Fallback reconciliation)
 * Uses API Key -> Auth Token flow
 */
export async function inquireTransaction(transactionId) {
  const apiKey = getPaymobApiKey();
  if (!apiKey) {
    throw new Error("PAYMOB_API_KEY is not configured");
  }

  // Step 1: Get short-lived Auth Token
  const tokenRes = await fetch(`${getPaymobBaseUrl()}/api/auth/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey }),
  });

  if (!tokenRes.ok) {
    throw new Error("Failed to authenticate with Paymob API Key for transaction inquiry");
  }

  const { token } = await tokenRes.json();

  // Step 2: Inquire transaction by ID
  const txnRes = await fetch(`${getPaymobBaseUrl()}/api/acceptance/transactions/${encodeURIComponent(String(transactionId))}`, {
    method: "GET",
    headers: { "Authorization": `Bearer ${token}` },
  });

  if (!txnRes.ok) {
    const errorData = await txnRes.json().catch(() => ({}));
    throw new Error(`Paymob transaction inquiry failed: ${errorData.message || JSON.stringify(errorData)}`);
  }

  return await txnRes.json();
}

/**
 * Finds the latest transaction for a Paymob order/reference.
 *
 * This is essential when the transaction-processed callback is missed or rejected: until a
 * callback is accepted, the local Payment row has an order id but deliberately has no provider
 * transaction id.  Looking up only by transaction id therefore can never repair the incident.
 */
export async function inquireLatestTransactionByOrder({ orderId, merchantOrderId } = {}) {
  if (!orderId && !merchantOrderId) {
    throw new Error("Either orderId or merchantOrderId is required for Paymob transaction inquiry");
  }

  const authToken = await getPaymobAuthToken();
  const response = await fetch(`${getPaymobBaseUrl()}/api/ecommerce/orders/transaction_inquiry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Paymob validates an omitted lookup key differently from an empty string. Its lookup modes
    // are alternatives, so prefer the provider order ID when we have it and otherwise query our
    // merchant reference; never submit an empty or competing lookup field.
    body: JSON.stringify({
      auth_token: authToken,
      ...(orderId
        ? { order_id: String(orderId) }
        : { merchant_order_id: String(merchantOrderId) }),
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Paymob order transaction inquiry failed: ${errorData.detail || errorData.message || JSON.stringify(errorData)}`);
  }

  return await response.json();
}

/**
 * Step 1: Obtain Paymob Authentication Token (Classic Flow)
 */
export async function getPaymobAuthToken() {
  const apiKey = getPaymobApiKey();
  if (!apiKey) {
    throw new Error("PAYMOB_API_KEY is not configured");
  }

  const res = await fetch(`${getPaymobBaseUrl()}/api/auth/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Paymob Auth Failed: ${err.detail || res.statusText}`);
  }

  const data = await res.json();
  return data.token;
}

/**
 * Step 2: Register Order on Paymob (Classic Flow)
 */
export async function registerPaymobOrder({ authToken, amountCents, merchantOrderId, items = [] }) {
  const res = await fetch(`${getPaymobBaseUrl()}/api/ecommerce/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_token: authToken,
      delivery_needed: "false",
      amount_cents: String(amountCents),
      currency: "EGP",
      merchant_order_id: merchantOrderId,
      items: items.map((item) => ({
        name: item.name || "Court Booking",
        amount_cents: String(item.amountCents || item.amount || amountCents),
        description: item.description || "Mal3bk Reservation",
        quantity: String(item.quantity || 1),
      })),
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Paymob Order Registration Failed: ${JSON.stringify(err)}`);
  }

  const data = await res.json();
  return data.id;
}

/**
 * Step 3: Generate Payment Key Token for Wallet Integration (Classic Flow)
 */
export async function generateWalletPaymentKey({
  authToken,
  amountCents,
  orderId,
  billingData,
  expirationSeconds = 3600,
}) {
  const integrationId = requireIntegrationId(getWalletIntegrationId(), "PAYMOB_INTEGRATION_ID_WALLET");

  const payload = {
    auth_token: authToken,
    amount_cents: String(amountCents),
    expiration: expirationSeconds,
    order_id: String(orderId),
    billing_data: {
      first_name: billingData.firstName || "Player",
      last_name: billingData.lastName || "User",
      email: billingData.email || "player@mal3bk.com",
      phone_number: billingData.phone || "01000000000",
      apartment: "NA",
      floor: "NA",
      street: "NA",
      building: "NA",
      shipping_method: "NA",
      postal_code: "NA",
      city: "Cairo",
      country: "EGY",
      state: "Cairo",
    },
    currency: "EGP",
    integration_id: integrationId,
    lock_order_when_paid: "true",
  };

  const res = await fetch(`${getPaymobBaseUrl()}/api/acceptance/payment_keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Paymob Payment Key Generation Failed: ${JSON.stringify(err)}`);
  }

  const data = await res.json();
  return data.token;
}

/**
 * Step 4: Execute Wallet Pay Request (Direct OTP / Redirect URL)
 */
export async function executeWalletPayment({ paymentKeyToken, walletMobileNumber }) {
  let formattedNumber = walletMobileNumber.trim().replace(/\s+/g, "").replace(/^\+20/, "0").replace(/^20/, "0");

  const payload = {
    source: {
      identifier: formattedNumber,
      subtype: "WALLET",
    },
    payment_token: paymentKeyToken,
  };

  const res = await fetch(`${getPaymobBaseUrl()}/api/acceptance/payments/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Paymob Wallet Pay Request Failed: ${JSON.stringify(err)}`);
  }

  const data = await res.json();
  return {
    redirectUrl: data.redirect_url || data.iframe_redirection_url,
    pending: data.pending,
    success: data.success,
    transactionId: data.id,
    rawResponse: data,
  };
}
