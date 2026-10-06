import { prisma } from "../../db/prisma.js";
import { randomUUID } from "crypto";
import {
  createPaymentIntention,
  verifyTransactionHmac,
  inquireTransaction,
  inquireLatestTransactionByOrder,
  getPaymobAuthToken,
  registerPaymobOrder,
  generateWalletPaymentKey,
  executeWalletPayment,
} from "./paymob.service.js";
import {
  attemptRefundSettlement,
  processRefundOutboxService,
} from "./refund-settlement.service.js";
import {
  ensureCourtAvailable,
  calculateBookingPricing,
  generateUniqueCode,
  formatBookingCancellation,
} from "../bookings/bookings.service.js";
import {
  validateCouponForBookingService,
  recordCouponRedemptionService,
} from "../coupons/coupons.service.js";
import { createNotificationsTx } from "../notifications/notifications.service.js";

export { attemptRefundSettlement, processRefundOutboxService };

const PAYMENT_RECONCILIATION_ALERT_AFTER_MS = Math.max(
  5 * 60 * 1000,
  (Number(process.env.PAYMOB_RECONCILIATION_ALERT_AFTER_MINUTES) || 20) * 60 * 1000,
);
const GATEWAY_OPERATIONAL_ALERT_COOLDOWN_MS = 5 * 60 * 1000;

function logPaymentEvent(level, event, fields = {}) {
  // Structured, secret-free events are consumable by Hostinger/PM2 log collection and make a
  // payment failure searchable without writing card data, callback bodies, HMACs or API keys.
  const payload = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    provider: "paymob",
    ...fields,
  });
  console[level]?.(payload);
}

/**
 * Sends one durable, rate-limited operational alert for gateway failures which cannot safely be
 * attached to a trusted payment record (for example, a rejected HMAC). It deliberately records
 * no raw callback or HMAC material.
 */
async function raiseGatewayOperationalAlert({ eventKey, title, titleAr, message, messageAr, metadata = {} }) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`paymob-operational:${eventKey}`}))`;
    const recent = await tx.notification.findFirst({
      where: {
        eventKey,
        createdAt: { gte: new Date(Date.now() - GATEWAY_OPERATIONAL_ALERT_COOLDOWN_MS) },
      },
      select: { id: true },
    });
    if (recent) return false;

    const admins = await tx.user.findMany({
      where: { role: "admin", deletedAt: null },
      select: { id: true },
    });
    if (!admins.length) {
      logPaymentEvent("error", "paymob.operational_alert_unroutable", { eventKey });
      return false;
    }

    await createNotificationsTx(tx, admins.map((admin) => ({
      userId: admin.id,
      actorUserId: null,
      type: "error",
      priority: "urgent",
      category: "admin",
      eventKey,
      title,
      titleAr,
      message,
      messageAr,
      link: "/dashboard/admin",
      metadata,
    })));
    return true;
  });
}

function paymentVerificationPendingError() {
  const error = new Error("A Paymob payment for this booking is still being verified. Do not retry payment; your booking remains protected while we confirm the gateway result.");
  error.status = 409;
  error.code = "PAYMENT_VERIFICATION_PENDING";
  return error;
}

/**
 * Make creation of a checkout attempt mutually exclusive per booking. Frontend debouncing is
 * helpful UX, but it is not a financial guarantee: duplicate tabs, retries and concurrent HTTP
 * requests all reach this transaction. The booking row lock makes exactly one pending Paymob
 * attempt durable before any gateway request is allowed to begin.
 */
async function createPendingPaymobAttempt(data) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${data.bookingId} FOR UPDATE`;
    const existing = await tx.payment.findFirst({
      where: {
        bookingId: data.bookingId,
        provider: "paymob",
        status: "pending",
      },
      select: { id: true },
    });
    if (existing) throw paymentVerificationPendingError();
    return tx.payment.create({ data });
  });
}

/**
 * Persist an operator-visible incident exactly once for a payment that cannot be reconciled.
 * A pending state is not allowed to be silent: the booking remains protected, retries remain
 * blocked, and an administrator receives durable evidence to investigate or refund manually.
 */
async function raisePaymentReconciliationIncident(paymentId, reason) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`paymob-incident:${paymentId}`}))`;
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: {
        booking: {
          select: { id: true, courtId: true, date: true, startTime: true, endTime: true },
        },
      },
    });
    if (!payment || payment.status !== "pending") return false;

    const now = new Date();
    const firstAlert = !payment.reconciliationAlertedAt;
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        reconciliationLastError: String(reason || "Paymob payment could not be reconciled").slice(0, 4000),
        ...(firstAlert ? { reconciliationAlertedAt: now } : {}),
      },
    });
    if (!firstAlert) return false;

    const admins = await tx.user.findMany({
      where: { role: "admin", deletedAt: null },
      select: { id: true },
    });
    if (!admins.length) {
      console.error(`[Paymob Reconciliation Incident] No active admin to notify (payment=${payment.id}).`);
      return true;
    }

    await createNotificationsTx(tx, admins.map((admin) => ({
      userId: admin.id,
      actorUserId: null,
      type: "error",
      priority: "urgent",
      category: "admin",
      eventKey: "paymob_reconciliation_incident",
      title: "Paymob payment needs attention",
      titleAr: "دفعة Paymob تحتاج إلى مراجعة",
      message: `Payment ${payment.id} for booking ${payment.bookingId} could not be reconciled automatically. The booking remains protected and further payment attempts are blocked.`,
      messageAr: `تعذر مطابقة دفعة Paymob للحجز ${payment.bookingId} تلقائياً. الحجز ما زال محمياً وتم منع محاولات دفع إضافية.`,
      link: "/dashboard/admin",
      metadata: {
        paymentId: payment.id,
        bookingId: payment.bookingId,
        courtId: payment.booking?.courtId || null,
        paymobOrderId: payment.paymobOrderId,
        paymobTransactionId: payment.paymobTransactionId,
        merchantReference: payment.merchantReference,
        reason: String(reason || "Paymob payment could not be reconciled").slice(0, 1000),
      },
    })));
    return true;
  });
}

export function calculateOnlinePaymentAmount(totalPrice, court) {
  const normalizedTotal = Number(totalPrice) || 0;
  let amount = normalizedTotal;

  if (court?.paymentPolicy === "percentage") {
    amount = (normalizedTotal * Number(court.depositValue || 0)) / 100;
  } else if (court?.paymentPolicy === "fixed") {
    amount = Math.min(normalizedTotal, Number(court.depositValue || 0));
  }

  return Math.round(amount * 100) / 100;
}

/**
 * Creates a checkout session for court booking via Paymob.
 */
export async function createCheckoutSessionService({
  userId,
  bookingId,
  courtId,
  date,
  startTime,
  endTime,
  notes,
  couponCode,
  paymentMethodType = "card",
}) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, phone: true },
  });

  if (!user) {
    const err = new Error("User not found");
    err.status = 404;
    throw err;
  }

  let booking;
  let court;
  let amount = 0;
  let amountCents = 0;
  let bookingDate = date;
  let bookingStartTime = startTime;
  let bookingEndTime = endTime;

  if (bookingId) {
    booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { court: true },
    });

    if (!booking) {
      const err = new Error("Booking not found");
      err.status = 404;
      throw err;
    }

    if (booking.userId !== userId) {
      const err = new Error("Unauthorized access to this booking");
      err.status = 403;
      throw err;
    }

    // A refund is durable but not necessarily settled yet. Starting another checkout against the
    // same booking would create a second payment intent while the first captured amount is being
    // returned, so this state is strictly terminal for re-checkout.
    if (booking.paymentStatus === "refund_pending") {
      const err = new Error("A refund is already being processed for this booking. Please wait for it to complete before creating a new booking.");
      err.status = 400;
      throw err;
    }

    if (["cancelled", "completed", "no_show"].includes(booking.status)) {
      const err = new Error("This booking is no longer eligible for online payment.");
      err.status = 400;
      throw err;
    }

    if (booking.paymentStatus === "paid") {
      const err = new Error("This booking has already been paid.");
      err.status = 400;
      throw err;
    }

    if (booking.paymentStatus === "refunded") {
      const err = new Error("This booking has been refunded and cannot be paid again.");
      err.status = 400;
      throw err;
    }

    // Never create a second Paymob intention while the outcome of the first one is unknown.
    // A lost/rejected webhook leaves the local payment pending even though Paymob may already
    // have captured the card.  Creating another checkout here is how a customer can be charged
    // twice.  The reconciliation worker/status endpoint resolves this record before a retry is
    // permitted.
    const inFlightPayment = await prisma.payment.findFirst({
      where: {
        bookingId: booking.id,
        provider: "paymob",
        status: "pending",
        OR: [
          { paymobOrderId: { not: null } },
          { merchantReference: { not: null } },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (inFlightPayment) {
      throw paymentVerificationPendingError();
    }

    court = booking.court;

    // Guard: court must allow online payments
    if (court.allowOnlinePayment === false) {
      const err = new Error("This court does not accept online payments.");
      err.status = 403;
      throw err;
    }

    const totalPrice = Number(booking.totalPrice) || Number(booking.amount) || 0;
    amount = calculateOnlinePaymentAmount(totalPrice, court);

    if (amount <= 0 || amount > totalPrice) {
      const err = new Error("Invalid online payment amount. Amount must be greater than 0 and cannot exceed the total price of the booking.");
      err.status = 400;
      throw err;
    }

    amountCents = Math.round(amount * 100);
    if (Number(booking.amount) !== amount) {
      booking = await prisma.booking.update({
        where: { id: booking.id },
        data: { amount },
        include: { court: true },
      });
    }
    bookingDate = booking.date;
    bookingStartTime = booking.startTime;
    bookingEndTime = booking.endTime;
  } else {
    // Validate availability and create hold atomically in a transaction
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5-minute reservation hold

    const txResult = await prisma.$transaction(async (tx) => {
      const c = await ensureCourtAvailable(courtId, date, startTime, endTime, null, tx);

      // A previous hold can have been incorrectly marked cancelled before its Paymob result
      // arrived.  Availability alone is therefore not enough protection: creating a fresh
      // booking for the same player and slot would create a second charge.  Hold the retry until
      // the prior gateway order has been reconciled to a final state.
      const unresolvedChargeForSlot = await tx.payment.findFirst({
        where: {
          userId,
          provider: "paymob",
          status: "pending",
          OR: [
            { paymobOrderId: { not: null } },
            { merchantReference: { not: null } },
          ],
          booking: {
            is: {
              courtId: c.id,
              date,
              startTime,
              endTime,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (unresolvedChargeForSlot) {
        const err = paymentVerificationPendingError();
        err.message = "A Paymob payment for this slot is still being verified. Do not retry payment; we will finalize the existing booking once the gateway result is confirmed.";
        throw err;
      }

      // Guard: court must allow online payments
      if (c.allowOnlinePayment === false) {
        const err = new Error("This court does not accept online payments.");
        err.status = 403;
        throw err;
      }

      const pricing = calculateBookingPricing(c, startTime, endTime);
      let finalTotalPrice = pricing.totalPrice;
      let appliedDiscountType = null;
      let appliedDiscountValue = null;
      let appliedCouponId = null;
      let appliedDiscountAmount = 0;

      if (couponCode) {
        const couponValidation = await validateCouponForBookingService({
          code: couponCode,
          courtId: c.id,
          bookingAmount: pricing.totalPrice,
          userId: user.id,
          tx,
        });

        appliedDiscountType = couponValidation.coupon.discountType;
        appliedDiscountValue = couponValidation.coupon.discountValue;
        appliedCouponId = couponValidation.coupon.id;
        appliedDiscountAmount = couponValidation.discountAmount;
        finalTotalPrice = couponValidation.finalAmount;
      }

      const computedAmount = calculateOnlinePaymentAmount(finalTotalPrice, c);

      const checkInCode = await generateUniqueCode(tx);

      const b = await tx.booking.create({
        data: {
          courtId: c.id,
          userId: user.id,
          date,
          startTime,
          endTime,
          sessionOpenTime: c.openTime || "08:00",
          sessionCloseTime: c.closeTime || "23:59",
          useOpeningDayForOvernightBookings: c.useOpeningDayForOvernightBookings || false,
          duration: pricing.duration * 60,
          totalPrice: finalTotalPrice,
          amount: computedAmount,
          discountType: appliedDiscountType,
          discountValue: appliedDiscountValue,
          couponId: appliedCouponId,
          status: "pending",
          paymentStatus: "pending",
          paymentMethod: paymentMethodType,
          checkInCode,
          expiresAt,
          notes: notes || "Paymob Online Booking",
        },
      });

      if (appliedCouponId) {
        await recordCouponRedemptionService({
          couponId: appliedCouponId,
          userId: user.id,
          bookingId: b.id,
          discountAmount: appliedDiscountAmount,
          tx,
        });
      }

      return { court: c, booking: b, computedAmount };
    });

    court = txResult.court;
    booking = txResult.booking;
    amount = txResult.computedAmount;
    amountCents = Math.round(txResult.computedAmount * 100);
  }

  // Prepare names
  const nameParts = (user.name || "Player User").trim().split(" ");
  const firstName = nameParts[0] || "Player";
  const lastName = nameParts.slice(1).join(" ") || "User";

  // Write the durable local attempt FIRST. If the process crashes after Paymob accepts the
  // intention but before it returns/saves its order ID, this merchant reference remains available
  // for the reconciler to query by merchant_order_id. Without it, a real capture could be lost.
  const merchantReference = `${booking.id}_${randomUUID()}`;
  const createdPayment = await createPendingPaymobAttempt({
    bookingId: booking.id,
    userId: user.id,
    provider: "paymob",
    merchantReference,
    amountCents,
    currency: "EGP",
    paymentMethod: paymentMethodType,
    status: "pending",
  });

  let intentionData;
  try {
    intentionData = await createPaymentIntention({
      amountCents,
      currency: "EGP",
      specialReference: merchantReference,
      paymentMethodType,
      customer: {
        firstName,
        lastName,
        email: user.email,
        phone: user.phone || "+201000000000",
      },
      items: [
        {
          name: `${court.name || "Court"} Booking (${bookingDate} ${bookingStartTime}-${bookingEndTime})`,
          amount: amountCents,
          quantity: 1,
        },
      ],
    });
  } catch (error) {
    // Only a confirmed 4xx rejection is safe to release for a fresh attempt. A network error or
    // 5xx is ambiguous: Paymob may have accepted it, so retain the durable attempt and reconcile
    // it by merchantReference instead of allowing the customer to be charged a second time.
    if (error?.definitive === true) {
      await prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: createdPayment.id },
          data: { status: "failed", reconciliationLastError: error.message || String(error) },
        });
        // A confirmed pre-payment rejection never captured money, so it is safe to release this
        // booking immediately. Ambiguous failures deliberately do NOT take this path.
        await tx.booking.updateMany({
          where: { id: booking.id, status: "pending", paymentStatus: { not: "paid" } },
          data: { status: "cancelled", paymentStatus: "failed", cancellationReason: "system" },
        });
      }).catch((persistError) => {
        console.error("[Paymob Attempt] Could not persist definitive intention rejection:", persistError);
      });
    } else {
      await prisma.payment.update({
        where: { id: createdPayment.id },
        data: { reconciliationLastError: error?.message || String(error) },
      }).catch((persistError) => {
        console.error("[Paymob Attempt] Could not persist ambiguous intention error:", persistError);
      });
    }
    throw error;
  }

  // If this write fails after Paymob accepts the intention, still return the checkout URL. The
  // pre-created row + merchant reference guarantee recovery; failing the customer here would only
  // create an unnecessary retry opportunity.
  let payment = createdPayment;
  try {
    payment = await prisma.payment.update({
      where: { id: createdPayment.id },
      data: {
        paymobIntentionId: intentionData.id,
        paymobOrderId: intentionData.paymobOrderId ? String(intentionData.paymobOrderId) : null,
        clientSecret: intentionData.clientSecret,
        reconciliationLastError: null,
      },
    });
  } catch (persistError) {
    console.error(`[Paymob Attempt] Intention accepted but local metadata persistence failed (payment=${createdPayment.id}):`, persistError);
  }

  return {
    bookingId: booking.id,
    paymentId: payment.id,
    clientSecret: intentionData.clientSecret,
    checkoutUrl: intentionData.checkoutUrl,
    expiresAt: booking.expiresAt,
    amount,
    currency: "EGP",
  };
}

/**
 * Initiate Direct Mobile Wallet Payment (4-Step sequence)
 */
export async function initiateWalletPaymentService({ userId, bookingId, walletNumber }) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { court: true, user: true },
  });

  if (!booking) {
    const err = new Error("Booking not found");
    err.status = 404;
    throw err;
  }

  if (booking.userId !== userId) {
    const err = new Error("Unauthorized access to this booking");
    err.status = 403;
    throw err;
  }

  if (booking.paymentStatus === "refund_pending") {
    const err = new Error("A refund is already being processed for this booking. Please wait for it to complete before creating a new booking.");
    err.status = 400;
    throw err;
  }

  if (booking.paymentStatus === "paid" || booking.status === "confirmed") {
    const err = new Error("Booking is already confirmed and paid");
    err.status = 400;
    throw err;
  }

  if (booking.paymentStatus === "refunded") {
    const err = new Error("This booking has been refunded and cannot be paid again.");
    err.status = 400;
    throw err;
  }

  if (["cancelled", "completed", "no_show"].includes(booking.status)) {
    const err = new Error("This booking is no longer eligible for online payment.");
    err.status = 400;
    throw err;
  }

  if (booking.expiresAt && new Date(booking.expiresAt) < new Date()) {
    const err = new Error("Reservation hold has expired. Please select a new slot.");
    err.status = 410;
    throw err;
  }

  const court = booking.court;
  if (court.allowOnlinePayment === false) {
    const err = new Error("This court does not accept online payments.");
    err.status = 403;
    throw err;
  }

  const totalPrice = Number(booking.totalPrice) || Number(booking.amount) || 0;
  const amount = Number(booking.amount) || calculateOnlinePaymentAmount(totalPrice, court);
  const amountCents = Math.round(amount * 100);
  const merchantOrderId = `${booking.id}_${randomUUID()}`;

  const user = booking.user || (await prisma.user.findUnique({ where: { id: userId } }));
  const nameParts = (user?.name || "Player User").trim().split(" ");
  const firstName = nameParts[0] || "Player";
  const lastName = nameParts.slice(1).join(" ") || "User";

  const inFlightPayment = await prisma.payment.findFirst({
    where: {
      bookingId: booking.id,
      provider: "paymob",
      status: "pending",
      OR: [
        { paymobOrderId: { not: null } },
        { merchantReference: { not: null } },
      ],
    },
    select: { id: true },
  });
  if (inFlightPayment) {
    throw paymentVerificationPendingError();
  }

  // As with Unified Checkout, persist before the first network request. A wallet order can be
  // accepted by Paymob even if this process dies before it stores the Paymob order/transaction ID.
  const createdPayment = await createPendingPaymobAttempt({
    bookingId: booking.id,
    userId,
    provider: "paymob",
    merchantReference: merchantOrderId,
    amountCents,
    currency: "EGP",
    paymentMethod: "wallet",
    status: "pending",
  });

  try {
    // Step 1: Get Auth Token
    const authToken = await getPaymobAuthToken();

    // Step 2: Register Order on Paymob
    const paymobOrderId = await registerPaymobOrder({
      authToken,
      amountCents,
      merchantOrderId,
      items: [
        {
          name: `${court.name || "Court"} Reservation`,
          amountCents,
          description: `Booking on ${booking.date} (${booking.startTime}-${booking.endTime})`,
          quantity: 1,
        },
      ],
    });

    // Persist immediately after the provider creates the order, before requesting a payment key.
    await prisma.payment.update({
      where: { id: createdPayment.id },
      data: { paymobOrderId: String(paymobOrderId), reconciliationLastError: null },
    }).catch((persistError) => {
      console.error(`[Paymob Attempt] Wallet order accepted but local metadata persistence failed (payment=${createdPayment.id}):`, persistError);
    });

    // Step 3: Generate Payment Key for Mobile Wallet
    const paymentKeyToken = await generateWalletPaymentKey({
      authToken,
      amountCents,
      orderId: paymobOrderId,
      billingData: {
        firstName,
        lastName,
        email: user?.email || "player@mal3bk.com",
        phone: walletNumber,
      },
    });

    // Step 4: Pay Request with Wallet Number
    const walletPayResult = await executeWalletPayment({
      paymentKeyToken,
      walletMobileNumber: walletNumber,
    });

    let payment = createdPayment;
    try {
      payment = await prisma.payment.update({
        where: { id: createdPayment.id },
        data: {
          paymobOrderId: String(paymobOrderId),
          paymobTransactionId: walletPayResult.transactionId ? String(walletPayResult.transactionId) : null,
          rawCallbackData: walletPayResult.rawResponse,
          reconciliationLastError: null,
        },
      });
    } catch (persistError) {
      console.error(`[Paymob Attempt] Wallet payment request accepted but local metadata persistence failed (payment=${createdPayment.id}):`, persistError);
    }

    return {
      paymentId: payment.id,
      bookingId: booking.id,
      redirectUrl: walletPayResult.redirectUrl,
      pending: walletPayResult.pending,
      amount,
      currency: "EGP",
    };
  } catch (error) {
    // A wallet API/network failure is ambiguous until Paymob is queried by the persisted merchant
    // reference. Preserve pending; the reconciler blocks a retry and raises an operator incident
    // if it cannot reach a final state.
    await prisma.payment.update({
      where: { id: createdPayment.id },
      data: { reconciliationLastError: error?.message || String(error) },
    }).catch((persistError) => {
      console.error("[Paymob Attempt] Could not persist wallet attempt error:", persistError);
    });
    throw error;
  }
}

/**
 * Builds the player + court-manager "booking confirmed" notifications for a settled payment.
 * Shared by every path that confirms a paid booking so the copy can never diverge.
 */
function buildPaidBookingNotifications(booking, payment) {
  const courtName = booking.court?.name || "Court";
  const courtNameEn = booking.court?.nameEn || courtName;
  const courtNameAr = booking.court?.name || courtNameEn;
  const playerName = booking.user?.name || "Player";
  const notifs = [];

  if (booking.userId) {
    notifs.push({
      userId: booking.userId,
      actorUserId: null,
      type: "success",
      category: "booking",
      eventKey: "booking_created",
      title: "Booking confirmed",
      titleAr: "تم تأكيد الحجز",
      message: `${courtNameEn} on ${booking.date} from ${booking.startTime} to ${booking.endTime} is confirmed. Check-in code: ${booking.checkInCode}`,
      messageAr: `تم تأكيد حجز ${courtNameAr} بتاريخ ${booking.date} من ${booking.startTime} إلى ${booking.endTime}. كود الدخول: ${booking.checkInCode}`,
      link: "/dashboard/player/bookings",
      metadata: {
        bookingId: booking.id,
        courtId: booking.courtId,
        date: booking.date,
        startTime: booking.startTime,
        endTime: booking.endTime,
        checkInCode: booking.checkInCode,
        amountCents: payment?.amountCents,
      },
    });
  }

  if (booking.court?.managerId && booking.court.managerId !== booking.userId) {
    notifs.push({
      userId: booking.court.managerId,
      actorUserId: booking.userId,
      type: "info",
      category: "booking",
      eventKey: "booking_created",
      title: "New booking received",
      titleAr: "تم استلام حجز جديد",
      message: `${playerName} booked ${courtNameEn} on ${booking.date} from ${booking.startTime} to ${booking.endTime}.`,
      messageAr: `قام ${playerName} بحجز ${courtNameAr} بتاريخ ${booking.date} من ${booking.startTime} إلى ${booking.endTime}.`,
      link: "/dashboard/manager/bookings",
      metadata: {
        bookingId: booking.id,
        courtId: booking.courtId,
        playerId: booking.userId,
        date: booking.date,
        startTime: booking.startTime,
        endTime: booking.endTime,
      },
    });
  }

  return notifs;
}

/**
 * Canonical reconciliation for a Paymob-confirmed SUCCESSFUL payment. Invoked identically by
 * the webhook handler AND the inquiry fallback so the two can never drift apart.
 *
 * MUST run inside a prisma.$transaction and performs NO external HTTP calls. If the money was
 * captured but the slot can no longer be honored (late settlement, slot re-taken), it sets
 * Payment.status = 'refund_pending' + Booking cancelled and returns outcome 'refund_pending' —
 * the caller settles the actual Paymob refund AFTER the tx commits (outbox pattern), so we
 * never hold a row lock across a gateway round-trip.
 *
 * @returns {{ outcome: 'confirmed'|'refund_pending', payment, booking, refundAmountCents:number }}
 */
async function reconcileSuccessfulPaymentTx(tx, {
  payment,
  transactionId,
  paymobOrderId,
  obj,
  verificationSource = "webhook",
}) {
  // Idempotent guard: never re-process a payment already in a terminal state. Prevents duplicate
  // confirmation notifications / re-triggered refunds if a settled callback is re-delivered.
  if (["paid", "refunded", "refund_pending"].includes(payment.status)) {
    return { outcome: "noop", payment, booking: null, refundAmountCents: 0 };
  }

  // Serialize reconciliation with explicit cancellation of this booking. The webhook already
  // owns its per-transaction advisory lock; this row lock prevents a cancellation committed
  // while this callback is in flight from being overwritten by a stale confirmation write.
  await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${payment.bookingId} FOR UPDATE`;

  const currentBooking = await tx.booking.findUnique({
    where: { id: payment.bookingId },
    include: { court: true, user: true },
  });

  const settledMethod = obj?.source_data?.sub_type || obj?.source_data?.type || payment.paymentMethod;

  // An explicit cancellation is terminal even when the court later appears free. Only a legacy
  // NULL reason or an automated hold expiry may be revived by a late successful payment.
  const wasExplicitlyCancelled = currentBooking?.status === "cancelled" &&
    ![null, "hold_expired"].includes(currentBooking.cancellationReason);

  // Late-settlement detection: the hold was already cancelled or its TTL has elapsed.
  const isLate = currentBooking && (
    currentBooking.status === "cancelled" ||
    (currentBooking.expiresAt && currentBooking.expiresAt < new Date())
  );

  if (isLate) {
    let slotAvailable = false;
    if (!wasExplicitlyCancelled) {
      slotAvailable = true;
      try {
        await ensureCourtAvailable(
          currentBooking.courtId,
          currentBooking.date,
          currentBooking.startTime,
          currentBooking.endTime,
          currentBooking.id,
          tx,
        );
      } catch {
        slotAvailable = false;
      }
    }

    if (!slotAvailable) {
      // Money captured but the slot is gone. Record the intent to refund and let the
      // post-commit outbox settle it with Paymob. NEVER call the refund API inside this tx.
      const refundAmountCents = Number(obj?.amount_cents) || payment.amountCents;
      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "refund_pending",
          refundRequestedCents: refundAmountCents,
          refundClaimedAt: null,
          paymobTransactionId: transactionId,
          paymobOrderId: paymobOrderId || payment.paymobOrderId,
          // An inquiry is authenticated directly to Paymob but it is not an HMAC callback.
          // Preserve the field's literal meaning so investigations do not mistake a recovered
          // payment for a verified webhook delivery.
          hmacVerified: verificationSource === "webhook" ? true : payment.hmacVerified,
          paymentMethod: settledMethod,
          rawCallbackData: obj,
          reconciliationLastError: null,
        },
      });

      await tx.booking.update({
        where: { id: currentBooking.id },
        data: {
          status: "cancelled",
          paymentStatus: "refund_pending",
          cancellationReason: currentBooking.cancellationReason || "hold_expired",
        },
      });

      if (currentBooking.userId) {
        const courtLabel = currentBooking.court?.nameEn || currentBooking.court?.name || "Court";
        const courtLabelAr = currentBooking.court?.name || courtLabel;
        const cancellationReason = currentBooking.cancellationReason || "hold_expired";
        const latePaymentCopy = cancellationReason === "manager"
          ? {
            title: "Refund in progress",
            titleAr: "جارٍ استرداد المبلغ",
            message: `The venue cancelled your booking at ${courtLabel} on ${currentBooking.date}. Your payment is being refunded to your original payment method. No action is needed from you.`,
            messageAr: `قام الملعب بإلغاء حجزك في ${courtLabelAr} بتاريخ ${currentBooking.date}. جارٍ استرداد المبلغ إلى وسيلة الدفع الأصلية ولا يلزمك أي إجراء.`,
          }
          : cancellationReason === "hold_expired"
            ? {
              title: "Refund in progress",
              titleAr: "جارٍ استرداد المبلغ",
              message: `Your payment for ${courtLabel} on ${currentBooking.date} could not be confirmed in time because the slot was taken. Your payment is being refunded to your original payment method.`,
              messageAr: `تعذّر تأكيد دفعتك لحجز ${courtLabelAr} بتاريخ ${currentBooking.date} في الوقت المناسب لأن الموعد تم حجزه. جارٍ استرداد المبلغ إلى وسيلة الدفع الأصلية.`,
            }
            : {
              title: "Refund in progress",
              titleAr: "جارٍ استرداد المبلغ",
              message: `We could not complete your booking at ${courtLabel} on ${currentBooking.date}. Your payment is being refunded to your original payment method. No action is needed from you.`,
              messageAr: `لم نتمكن من إتمام حجزك في ${courtLabelAr} بتاريخ ${currentBooking.date}. جارٍ استرداد المبلغ إلى وسيلة الدفع الأصلية ولا يلزمك أي إجراء.`,
            };
        await createNotificationsTx(tx, [
          {
            userId: currentBooking.userId,
            actorUserId: null,
            type: "warning",
            category: "booking",
            eventKey: "booking_cancelled",
            title: latePaymentCopy.title,
            titleAr: latePaymentCopy.titleAr,
            message: latePaymentCopy.message,
            messageAr: latePaymentCopy.messageAr,
            link: "/dashboard/player/bookings",
            metadata: {
              bookingId: currentBooking.id,
              courtId: currentBooking.courtId,
              refundPending: true,
              refundStatus: "processing",
              cancellationReason,
            },
          },
        ]);
      }

      return { outcome: "refund_pending", payment: updatedPayment, booking: currentBooking, refundAmountCents };
    }
    // Slot is still free → safe to confirm as normal.
  }

  const updatedPayment = await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: "paid",
      paymobTransactionId: transactionId,
      paymobOrderId: paymobOrderId || payment.paymobOrderId,
      hmacVerified: verificationSource === "webhook" ? true : payment.hmacVerified,
      paymentMethod: settledMethod,
      rawCallbackData: obj,
      reconciliationLastError: null,
    },
  });

  await tx.booking.update({
    where: { id: updatedPayment.bookingId },
    data: {
      status: "confirmed",
      paymentStatus: "paid",
      paymentMethod: settledMethod || "paymob",
      expiresAt: null, // Clear hold TTL upon confirmation
      cancellationReason: null,
    },
  });

  if (currentBooking) {
    const notifs = buildPaidBookingNotifications(currentBooking, updatedPayment);
    if (notifs.length > 0) {
      await createNotificationsTx(tx, notifs);
    }
  }

  return { outcome: "confirmed", payment: updatedPayment, booking: currentBooking, refundAmountCents: 0 };
}

/**
 * Handle incoming Paymob Webhook (POST Callback)
 * Immediately persists to WebhookAuditLog before processing, with try/catch DLQ safety.
 */
export async function handlePaymobWebhookService(body, receivedHmac, { auditLogId = null } = {}) {
  const transactionId = body?.obj?.id ? String(body.obj.id) : null;
  const eventType = body?.type || "TRANSACTION";

  // 1. Immediate Webhook Interception: Persist raw payload to WebhookAuditLog
  let auditLog = null;
  try {
    // A DLQ retry must update its original receipt. Creating a new record for every attempt
    // leaves the original pending forever and makes the audit trail look like repeated gateway
    // deliveries rather than one retrying delivery.
    auditLog = auditLogId
      ? await prisma.webhookAuditLog.findUnique({ where: { id: auditLogId } })
      : await prisma.webhookAuditLog.create({
        data: {
          provider: "paymob",
          transactionId,
          eventType,
          rawPayload: body ?? {},
          receivedHmac: receivedHmac || null,
          status: "pending",
        },
      });
  } catch (auditErr) {
    console.error("[Webhook Audit Log Interception Warning]:", auditErr);
  }

  const obj = body?.obj;
  if (!obj) {
    if (auditLog) {
      await prisma.webhookAuditLog.update({
        where: { id: auditLog.id },
        data: { status: "rejected", lastError: "MISSING_PAYLOAD", attempts: { increment: 1 } },
      }).catch(() => {});
    }
    return { success: false, reason: "MISSING_PAYLOAD" };
  }

  // 2. Verify HMAC SHA-512
  const isValidHmac = verifyTransactionHmac(obj, receivedHmac);
  if (!isValidHmac) {
    if (auditLog) {
      await prisma.webhookAuditLog.update({
        where: { id: auditLog.id },
        data: { isValidHmac: false, status: "rejected", lastError: "INVALID_HMAC", attempts: { increment: 1 } },
      }).catch(() => {});
    }
    logPaymentEvent("warn", "paymob.webhook_hmac_rejected", {
      transactionId,
      auditLogId: auditLog?.id || null,
    });
    await raiseGatewayOperationalAlert({
      eventKey: "paymob_hmac_failure",
      title: "Paymob callback failed HMAC verification",
      titleAr: "فشل التحقق من توقيع HMAC الخاص بـ Paymob",
      message: "A Paymob callback was rejected. No payment state was changed; review the Paymob HMAC secret and callback routing.",
      messageAr: "تم رفض رد من Paymob. لم يتم تغيير حالة أي دفعة؛ راجع سر HMAC ومسار رد Paymob.",
      metadata: { transactionId, auditLogId: auditLog?.id || null },
    }).catch((alertError) => {
      logPaymentEvent("error", "paymob.hmac_alert_delivery_failed", { message: alertError?.message || String(alertError) });
    });
    return { success: false, reason: "INVALID_HMAC" };
  }

  if (auditLog) {
    await prisma.webhookAuditLog.update({
      where: { id: auditLog.id },
      data: { isValidHmac: true },
    }).catch(() => {});
  }

  // 3. Execute Atomic Database Update with Full Try/Catch Safety Net
  try {
    const paymobOrderId = String(obj.order?.id || "");
    const rawReference = obj.order?.merchant_order_id || obj.special_reference || "";
    // Strip off the timestamp we appended to avoid Paymob duplicate order errors
    const specialReference = rawReference.split('_')[0];
    const isPaidSuccess =
      obj.success === true &&
      obj.pending === false &&
      obj.is_refunded !== true &&
      obj.is_voided !== true;

    // Refund settlements run AFTER the tx commits so we never hold a row lock across a Paymob
    // API round-trip. The reconciliation sets this when captured money must be returned.
    let postCommitRefund = null;

    const result = await prisma.$transaction(async (tx) => {
      // Serialize concurrent callbacks for the SAME transaction so a duplicate burst cannot race
      // the dedup check under Read Committed. The advisory lock auto-releases on commit/rollback.
      const lockKey = transactionId || paymobOrderId || specialReference || "paymob_webhook";
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${String(lockKey)}))`;

      // Check if this transaction has already been processed (Deduplication)
      const existingTransaction = await tx.payment.findUnique({
        where: { paymobTransactionId: transactionId },
      });

      if (existingTransaction && ["paid", "refunded", "refund_pending"].includes(existingTransaction.status)) {
        return { duplicate: true, payment: existingTransaction };
      }

      // Find payment by paymobOrderId or booking specialReference
      let payment = await tx.payment.findFirst({
        where: {
          OR: [
            { paymobOrderId: paymobOrderId },
            { merchantReference: rawReference || "" },
            { bookingId: specialReference || "" },
            { id: specialReference || "" },
          ],
        },
      });

      if (isPaidSuccess) {
        const callbackAmountCents = Number(obj.amount_cents);
        const callbackCurrency = String(obj.currency || "EGP");
        let expectedAmountCents = payment ? Number(payment.amountCents) : 0;
        if (!payment && specialReference) {
          const referencedBooking = await tx.booking.findUnique({
            where: { id: specialReference },
            select: { amount: true },
          });
          expectedAmountCents = Math.round(Number(referencedBooking?.amount || 0) * 100);
        }
        const expectedCurrency = payment?.currency || "EGP";

        if (!Number.isFinite(callbackAmountCents) || callbackAmountCents !== expectedAmountCents || callbackCurrency !== expectedCurrency) {
          return { rejected: true, reason: "PAYMENT_AMOUNT_MISMATCH" };
        }
      }

      // Branch A: Portal Refund Webhook
      if (obj.is_refunded === true) {
        if (payment) {
          payment = await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: "refunded",
              rawCallbackData: obj,
            },
          });
          await tx.booking.update({
            where: { id: payment.bookingId },
            data: {
              status: "cancelled",
              paymentStatus: "refunded",
              // A portal refund is an explicit operator action, not an expired payment hold.
              cancellationReason: "manager",
            },
          });
        }
        return { duplicate: false, payment };
      }

      // Branch B: Successful Payment — unified reconciliation shared with the inquiry fallback.
      if (isPaidSuccess) {
        // If no local payment row exists yet (e.g. the redirect raced the webhook), create a
        // pending one so the shared reconciliation has a concrete target to settle.
        if (!payment && specialReference) {
          const booking = await tx.booking.findUnique({ where: { id: specialReference } });
          if (booking) {
            payment = await tx.payment.create({
              data: {
                bookingId: booking.id,
                userId: booking.userId,
                provider: "paymob",
                merchantReference: rawReference || null,
                paymobOrderId: paymobOrderId || null,
                paymobTransactionId: transactionId,
                amountCents: Number(obj.amount_cents) || Math.round(Number(booking.amount) * 100),
                currency: obj.currency || "EGP",
                status: "pending",
                hmacVerified: true,
                rawCallbackData: obj,
              },
            });
          }
        }

        if (payment) {
          const rec = await reconcileSuccessfulPaymentTx(tx, {
            payment,
            transactionId,
            paymobOrderId,
            obj,
          });
          payment = rec.payment;
          if (rec.outcome === "refund_pending") {
            postCommitRefund = {
              paymentId: rec.payment.id,
              transactionId,
              amountCents: rec.refundAmountCents,
            };
          }
        }
      } else {
        // Branch C: Payment Failed or Pending (Allow retry while hold is active)
        if (payment) {
          // A response/redirect can be emitted while 3DS or another gateway step is still in
          // flight. Treat only an explicit *final* provider failure as terminal; otherwise the
          // reconciliation worker keeps the booking protected and asks Paymob again.
          const isFinalFailure = obj.pending === false && (
            obj.error_occured === true ||
            obj.success === false ||
            obj.is_voided === true
          );
          const newStatus = isFinalFailure ? "failed" : "pending";
          payment = await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: newStatus,
              paymobTransactionId: transactionId,
              hmacVerified: true,
              rawCallbackData: obj,
            },
          });

          // If explicit fatal error, immediately cancel the booking so the player can re-book
          if (newStatus === "failed") {
            await tx.booking.updateMany({
              where: { id: payment.bookingId, status: "pending", paymentStatus: { not: "paid" } },
              data: {
                status: "cancelled",
                paymentStatus: "failed",
                cancellationReason: "system",
              },
            });
          }
        }
      }

      return { duplicate: false, payment };
    });

    // Update audit log with successful or rejected processing result
    if (auditLog) {
      await prisma.webhookAuditLog.update({
        where: { id: auditLog.id },
        data: {
          status: result?.rejected ? "rejected" : "processed",
          lastError: result?.reason || null,
          processedAt: new Date(),
          attempts: { increment: 1 },
        },
      }).catch(() => {});
    }

    // Settle any required refund OUTSIDE the committed transaction (outbox pattern). On
    // failure the payment stays `refund_pending` and the refund outbox worker retries it.
    if (postCommitRefund) {
      await attemptRefundSettlement(postCommitRefund.paymentId);
    }

    if (result?.rejected) {
      logPaymentEvent("warn", "paymob.webhook_rejected", {
        transactionId,
        auditLogId: auditLog?.id || null,
        reason: result.reason,
      });
      return { success: false, reason: result.reason };
    }

    logPaymentEvent("info", "paymob.webhook_processed", {
      transactionId,
      paymobOrderId,
      paymentId: result?.payment?.id || null,
      paymentStatus: result?.payment?.status || null,
      outcome: result?.duplicate ? "duplicate" : (isPaidSuccess ? "paid" : "pending_or_failed"),
    });
    return { success: true, isPaid: isPaidSuccess, result, autoRefundedDueToTimeout: Boolean(postCommitRefund) };
  } catch (error) {
    // P2002 (unique violation on paymobTransactionId) means a concurrent callback already
    // recorded this transaction — a benign duplicate, not a failure. Mark the audit log
    // `processed` so the DLQ doesn't burn retries on it, and report success.
    if (error?.code === "P2002") {
      if (auditLog) {
        await prisma.webhookAuditLog.update({
          where: { id: auditLog.id },
          data: {
            status: "processed",
            lastError: "DUPLICATE_TRANSACTION",
            processedAt: new Date(),
            attempts: { increment: 1 },
          },
        }).catch(() => {});
      }
      return { success: true, duplicate: true };
    }

    logPaymentEvent("error", "paymob.webhook_processing_failed", {
      transactionId,
      auditLogId: auditLog?.id || null,
      message: error?.message || String(error),
    });
    if (auditLog) {
      await prisma.webhookAuditLog.update({
        where: { id: auditLog.id },
        data: {
          status: "failed",
          lastError: error.stack || error.message || String(error),
          attempts: { increment: 1 },
        },
      }).catch(() => {});
    }
    await raiseGatewayOperationalAlert({
      eventKey: "paymob_webhook_processing_failure",
      title: "Paymob webhook processing failed",
      titleAr: "فشلت معالجة رد Paymob",
      message: "A Paymob callback could not be processed. It is queued for retry and requires review if it remains unresolved.",
      messageAr: "تعذرت معالجة رد Paymob. تم وضعه في قائمة إعادة المحاولة ويحتاج مراجعة إذا بقي دون حل.",
      metadata: { transactionId, auditLogId: auditLog?.id || null },
    }).catch((alertError) => {
      logPaymentEvent("error", "paymob.webhook_failure_alert_delivery_failed", { message: alertError?.message || String(alertError) });
    });
    throw error;
  }
}

/**
 * DLQ Auto-Retry Worker: Re-process failed or pending webhooks from WebhookAuditLog
 */
export async function processDeadLetterQueueService({ maxAgeMinutes = 5, maxAttempts = 5, limit = 50 } = {}) {
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

  const pendingOrFailedLogs = await prisma.webhookAuditLog.findMany({
    where: {
      status: { in: ["failed", "pending"] },
      attempts: { lt: maxAttempts },
      createdAt: { lte: cutoff },
    },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  const summary = {
    totalScanned: pendingOrFailedLogs.length,
    succeeded: 0,
    failed: 0,
    deadLettered: 0,
    items: [],
  };

  for (const log of pendingOrFailedLogs) {
    try {
      const res = await handlePaymobWebhookService(log.rawPayload, log.receivedHmac, { auditLogId: log.id });
      summary.succeeded += 1;
      summary.items.push({ id: log.id, status: "processed", result: res });
    } catch (err) {
      const nextAttempts = log.attempts + 1;
      const isDead = nextAttempts >= maxAttempts;
      if (isDead) {
        summary.deadLettered += 1;
        await prisma.webhookAuditLog.update({
          where: { id: log.id },
          data: { status: "dead_letter", lastError: `DLQ Max Attempts Reached: ${err.message}` },
        }).catch(() => {});
      } else {
        summary.failed += 1;
      }
      summary.items.push({ id: log.id, status: isDead ? "dead_letter" : "failed", error: err.message });
    }
  }

  return summary;
}

/**
 * Reconcile one locally-pending Paymob payment using Paymob's authenticated Inquiry API.
 *
 * This intentionally works from the stored order id when no callback transaction id exists.
 * That is the normal state after a missed/rejected webhook and is the critical recovery path for
 * a card capture that otherwise would remain pending forever.
 */
async function reconcilePendingPaymentByInquiry(paymentId) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.status !== "pending") {
    return { outcome: "noop", payment: payment || null };
  }

  const inquiryResult = payment.paymobTransactionId
    ? await inquireTransaction(payment.paymobTransactionId)
    : await inquireLatestTransactionByOrder({
      orderId: payment.paymobOrderId,
      merchantOrderId: payment.merchantReference,
    });

  const transactionId = inquiryResult?.id ? String(inquiryResult.id) : payment.paymobTransactionId;
  const paymobOrderId = String(inquiryResult?.order?.id || payment.paymobOrderId || "");
  const isSettledSuccess =
    inquiryResult?.success === true &&
    inquiryResult?.pending === false &&
    inquiryResult?.is_refunded !== true &&
    inquiryResult?.is_voided !== true;

  if (isSettledSuccess) {
    const inquiryAmountCents = Number(inquiryResult?.amount_cents);
    const expectedAmountCents = Number(payment.amountCents);
    const expectedCurrency = String(payment.currency || "EGP");
    const actualCurrency = String(inquiryResult?.currency || "EGP");
    if (!transactionId || inquiryAmountCents !== expectedAmountCents || actualCurrency !== expectedCurrency) {
      return { outcome: "amount_mismatch", payment, inquiryResult };
    }

    let postCommitRefund = null;
    let reconciliation = null;
    await prisma.$transaction(async (tx) => {
      // Use the Paymob transaction as the serialization key. A webhook can arrive while this
      // lookup is in flight; both paths then converge through the same state transition.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`paymob-inquiry:${transactionId}`}))`;
      const freshPayment = await tx.payment.findUnique({ where: { id: payment.id } });
      if (!freshPayment || freshPayment.status !== "pending") {
        reconciliation = { outcome: "noop", payment: freshPayment || null };
        return;
      }

      reconciliation = await reconcileSuccessfulPaymentTx(tx, {
        payment: freshPayment,
        transactionId,
        paymobOrderId,
        obj: inquiryResult,
        verificationSource: "inquiry",
      });
      if (reconciliation.outcome === "refund_pending") {
        postCommitRefund = {
          paymentId: reconciliation.payment.id,
          transactionId,
          amountCents: reconciliation.refundAmountCents,
        };
      }
    });

    if (postCommitRefund) {
      await attemptRefundSettlement(postCommitRefund.paymentId);
    }
    return { ...(reconciliation || { outcome: "noop", payment: null }), inquiryResult };
  }

  // Only a final, explicitly unsuccessful provider result may release the slot. A pending or
  // unavailable inquiry is deliberately retained for another check; safety beats availability
  // when a card may still be captured.
  const isFinalFailure = inquiryResult?.pending === false &&
    (inquiryResult?.success === false || inquiryResult?.error_occured === true || inquiryResult?.is_voided === true);
  if (!isFinalFailure) {
    return { outcome: "pending", payment, inquiryResult };
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`paymob-inquiry:${transactionId || payment.id}`}))`;
    const freshPayment = await tx.payment.findUnique({ where: { id: payment.id } });
    if (!freshPayment || freshPayment.status !== "pending") return;

    await tx.payment.update({
      where: { id: freshPayment.id },
      data: {
        status: "failed",
        paymobTransactionId: transactionId || null,
        rawCallbackData: inquiryResult,
        reconciliationLastError: null,
      },
    });
    await tx.booking.updateMany({
      where: { id: freshPayment.bookingId, status: "pending", paymentStatus: { not: "paid" } },
      data: {
        status: "cancelled",
        paymentStatus: "failed",
        cancellationReason: "system",
      },
    });
  });

  return { outcome: "failed", payment, inquiryResult };
}

/**
 * Durable pull-based safety net for missed/rejected Paymob webhooks.  It is safe to call from
 * multiple processes because reconciliation itself is serialized on the provider transaction id.
 */
export async function reconcilePendingPaymobPaymentsService({ minAgeMinutes = 1, limit = 25 } = {}) {
  const cutoff = new Date(Date.now() - Math.max(0, Number(minAgeMinutes) || 0) * 60 * 1000);
  const candidates = await prisma.payment.findMany({
    where: {
      provider: "paymob",
      status: "pending",
      OR: [
        { paymobOrderId: { not: null } },
        { merchantReference: { not: null } },
      ],
      createdAt: { lte: cutoff },
    },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(Number(limit) || 25, 1), 100),
    select: { id: true, paymobOrderId: true, merchantReference: true },
  });

  const summary = {
    scanned: candidates.length,
    confirmed: 0,
    refundPending: 0,
    failed: 0,
    pending: 0,
    mismatched: 0,
    incidents: 0,
    errors: [],
  };
  for (const candidate of candidates) {
    try {
      const result = await reconcilePendingPaymentByInquiry(candidate.id);
      if (result.outcome === "confirmed") summary.confirmed += 1;
      else if (result.outcome === "refund_pending") summary.refundPending += 1;
      else if (result.outcome === "failed") summary.failed += 1;
      else if (result.outcome === "amount_mismatch") {
        summary.mismatched += 1;
        if (await raisePaymentReconciliationIncident(candidate.id, "Paymob success amount/currency did not match the local payment record.")) {
          summary.incidents += 1;
        }
      } else {
        summary.pending += 1;
        const ageMs = Date.now() - new Date(result.payment?.createdAt || 0).getTime();
        if (ageMs >= PAYMENT_RECONCILIATION_ALERT_AFTER_MS && await raisePaymentReconciliationIncident(
          candidate.id,
          "Paymob has not returned a final transaction result within the reconciliation safety window.",
        )) {
          summary.incidents += 1;
        }
      }
    } catch (error) {
      if (await raisePaymentReconciliationIncident(candidate.id, error.message || String(error))) {
        summary.incidents += 1;
      }
      summary.errors.push({
        paymentId: candidate.id,
        orderId: candidate.paymobOrderId,
        merchantReference: candidate.merchantReference,
        message: error.message || String(error),
      });
    }
  }
  return summary;
}

/**
 * Repairs the impossible-but-financially-dangerous state where a local payment was committed as
 * paid while its booking was not. This is independent of pending reconciliation so a database
 * partial failure, manual data mistake, or interrupted deploy cannot leave a captured payment
 * attached to a cancelled/pending booking indefinitely.
 *
 * Business rule: retain the booking only when its slot is still available; otherwise transition
 * it atomically to refund_pending and let the existing durable refund outbox make the customer
 * whole. Completed/no-show bookings are retained because the service was already delivered.
 */
export async function repairPaymobPaymentBookingInvariantsService({ limit = 25 } = {}) {
  const candidates = await prisma.payment.findMany({
    where: {
      provider: "paymob",
      status: "paid",
      booking: {
        is: {
          OR: [
            { paymentStatus: { not: "paid" } },
            { status: { notIn: ["confirmed", "completed", "no_show"] } },
          ],
        },
      },
    },
    select: { id: true },
    orderBy: { updatedAt: "asc" },
    take: Math.min(Math.max(Number(limit) || 25, 1), 100),
  });

  const summary = { scanned: candidates.length, confirmed: 0, refundsQueued: 0, completedFixed: 0, errors: [] };
  for (const candidate of candidates) {
    let repair = null;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`paymob-invariant:${candidate.id}`}))`;
        const payment = await tx.payment.findUnique({
          where: { id: candidate.id },
          include: {
            booking: { include: { court: true, user: true } },
          },
        });
        if (!payment || payment.provider !== "paymob" || payment.status !== "paid" || !payment.booking) {
          repair = { outcome: "noop" };
          return;
        }

        const booking = payment.booking;
        const alreadyConsistent = booking.paymentStatus === "paid" &&
          ["confirmed", "completed", "no_show"].includes(booking.status);
        if (alreadyConsistent) {
          repair = { outcome: "noop" };
          return;
        }

        await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${booking.id} FOR UPDATE`;
        if (["completed", "no_show"].includes(booking.status)) {
          await tx.booking.update({
            where: { id: booking.id },
            data: { paymentStatus: "paid", expiresAt: null },
          });
          repair = { outcome: "completed_fixed", payment, booking };
          return;
        }

        if (booking.status === "confirmed") {
          await tx.booking.update({
            where: { id: booking.id },
            data: { paymentStatus: "paid", expiresAt: null },
          });
          repair = { outcome: "confirmed", payment, booking };
          return;
        }

        let canHonorSlot = booking.status === "pending";
        if (canHonorSlot) {
          try {
            await ensureCourtAvailable(
              booking.courtId,
              booking.date,
              booking.startTime,
              booking.endTime,
              booking.id,
              tx,
            );
          } catch {
            canHonorSlot = false;
          }
        }

        if (canHonorSlot) {
          const repairedBooking = await tx.booking.update({
            where: { id: booking.id },
            data: {
              status: "confirmed",
              paymentStatus: "paid",
              expiresAt: null,
              cancellationReason: null,
            },
            include: { court: true, user: true },
          });
          await createNotificationsTx(tx, buildPaidBookingNotifications(repairedBooking, payment));
          repair = { outcome: "confirmed", payment, booking: repairedBooking };
          return;
        }

        // A cancelled or now-conflicting slot cannot be honored. Never leave a captured payment
        // in that state: create a durable refund intent in this same transaction.
        const refundPayment = await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: "refund_pending",
            refundRequestedCents: payment.amountCents,
            refundClaimedAt: null,
            reconciliationLastError: "Repaired paid-payment/booking-state mismatch; refund required.",
          },
        });
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: "cancelled",
            paymentStatus: "refund_pending",
            cancellationReason: booking.cancellationReason || "system",
          },
        });
        if (booking.userId) {
          await createNotificationsTx(tx, [{
            userId: booking.userId,
            actorUserId: null,
            type: "warning",
            category: "booking",
            eventKey: "booking_cancelled",
            title: "Refund in progress",
            titleAr: "جارٍ استرداد المبلغ",
            message: "We detected a payment/booking mismatch and are refunding your payment to the original method. No action is needed from you.",
            messageAr: "اكتشفنا عدم تطابق بين الدفعة والحجز ويجري رد المبلغ إلى وسيلة الدفع الأصلية. لا يلزمك أي إجراء.",
            link: "/dashboard/player/bookings",
            metadata: { bookingId: booking.id, paymentId: payment.id, refundPending: true, refundStatus: "processing" },
          }]);
        }
        repair = { outcome: "refund_pending", payment: refundPayment, booking };
      });

      if (repair?.outcome === "confirmed") summary.confirmed += 1;
      else if (repair?.outcome === "completed_fixed") summary.completedFixed += 1;
      else if (repair?.outcome === "refund_pending") {
        summary.refundsQueued += 1;
        if (repair.payment?.paymobTransactionId) {
          await attemptRefundSettlement(repair.payment.id);
        }
      }

      if (repair?.outcome && repair.outcome !== "noop") {
        logPaymentEvent("error", "paymob.payment_booking_mismatch_repaired", {
          paymentId: repair.payment?.id || candidate.id,
          bookingId: repair.booking?.id || null,
          outcome: repair.outcome,
        });
        await raiseGatewayOperationalAlert({
          eventKey: "paymob_payment_booking_mismatch",
          title: "Paymob payment/booking mismatch repaired",
          titleAr: "تم إصلاح عدم تطابق بين دفعة Paymob والحجز",
          message: "A payment/booking mismatch was detected and automatically repaired. Review the payment audit trail.",
          messageAr: "تم اكتشاف عدم تطابق بين دفعة والحجز وإصلاحه تلقائياً. راجع سجل الدفعة.",
          metadata: {
            paymentId: repair.payment?.id || candidate.id,
            bookingId: repair.booking?.id || null,
            outcome: repair.outcome,
          },
        });
      }
    } catch (error) {
      logPaymentEvent("error", "paymob.payment_booking_mismatch_repair_failed", {
        paymentId: candidate.id,
        message: error?.message || String(error),
      });
      summary.errors.push({ paymentId: candidate.id, message: error?.message || String(error) });
    }
  }
  return summary;
}

/**
 * Get payment status for a booking (with IDOR protection & active Paymob Inquiry fallback)
 */
export async function getPaymentStatusService(bookingId, currentUser, transactionId = null) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      court: {
        select: {
          id: true,
          managerId: true,
          name: true,
          nameEn: true,
          images: true,
          address: true,
          paymentPolicy: true,
          depositValue: true,
          allowOnlinePayment: true,
        },
      },
    },
  });

  if (!booking) {
    const err = new Error("Booking not found");
    err.status = 404;
    throw err;
  }

  // IDOR Protection: User must own the booking, manage the court, or be admin
  const currentUserId = typeof currentUser === "object" ? currentUser.id : currentUser;
  const currentUserRole = typeof currentUser === "object" ? currentUser.role : null;
  const isOwner = booking.userId === currentUserId;
  const isAdmin = currentUserRole === "admin";
  const isManager = currentUserRole === "manager" && booking.court?.managerId === currentUserId;

  if (!isOwner && !isAdmin && !isManager && currentUserRole !== null) {
    const err = new Error("You are not authorized to view this booking's payment status.");
    err.status = 403;
    throw err;
  }

  let latestPayment = booking.payments[0] || null;

  // Fallback check: query by callback transaction id when we have one, otherwise by the stored
  // Paymob order id. The latter is what exists after a missed webhook.
  const activeTxId = latestPayment?.paymobTransactionId || transactionId;
  if (latestPayment && latestPayment.status === "pending" && (
    activeTxId || latestPayment.paymobOrderId || latestPayment.merchantReference
  )) {
    try {
      await reconcilePendingPaymentByInquiry(latestPayment.id);

      // Reflect the settled state (confirmed OR refund_pending) in the response payload.
      const refreshed = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
          payments: { orderBy: { createdAt: "desc" }, take: 1 },
          court: {
            select: {
              id: true,
              managerId: true,
              name: true,
              nameEn: true,
              images: true,
              address: true,
              paymentPolicy: true,
              depositValue: true,
              allowOnlinePayment: true,
            },
          },
        },
      });
      if (refreshed) {
        booking.status = refreshed.status;
        booking.paymentStatus = refreshed.paymentStatus;
        booking.cancellationReason = refreshed.cancellationReason;
        latestPayment = refreshed.payments[0] || latestPayment;
      }
    } catch (error) {
      console.error("Paymob Inquiry API Fallback Error:", error);
      const err = new Error("Failed to verify payment status with payment provider. Please try again later.");
      err.status = 502;
      throw err;
    }
  }

  return {
    booking: {
      ...booking,
      cancellation: formatBookingCancellation(booking),
    },
    payment: latestPayment,
  };
}

/**
 * Refund a Payment (Admin/Manager action with Multi-tenant RBAC protection)
 */
export async function refundPaymentService(paymentIdOrBookingId, currentUser, customAmount = null) {
  let payment = await prisma.payment.findUnique({
    where: { id: paymentIdOrBookingId },
    include: {
      booking: {
        include: {
          court: {
            select: { id: true, managerId: true },
          },
        },
      },
    },
  });

  if (!payment) {
    // Try finding by bookingId
    payment = await prisma.payment.findFirst({
      where: {
        bookingId: paymentIdOrBookingId,
        status: "paid",
      },
      include: {
        booking: {
          include: {
            court: {
              select: { id: true, managerId: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  if (!payment) {
    const err = new Error("Payment record not found");
    err.status = 404;
    throw err;
  }

  // Multi-tenant RBAC: Manager must own the court, or caller must be admin
  const isAdmin = currentUser.role === "admin";
  const isCourtManager = currentUser.role === "manager" && payment.booking?.court?.managerId === currentUser.id;
  if (!isAdmin && !isCourtManager) {
    const err = new Error("You are not authorized to issue a refund for this court's bookings.");
    err.status = 403;
    throw err;
  }

  if (payment.status !== "paid" || !payment.paymobTransactionId) {
    const err = new Error("Payment is not eligible for refund");
    err.status = 400;
    throw err;
  }

  const refundAmountCents = customAmount
    ? Math.round(Number(customAmount) * 100)
    : payment.amountCents;

  if (!Number.isInteger(refundAmountCents) || refundAmountCents <= 0) {
    const err = new Error("Refund amount must be a positive amount in whole cents.");
    err.status = 400;
    throw err;
  }

  // Commit the refund intent first. The compare-and-set also prevents two manager/admin clicks
  // from dispatching two gateway refunds before either response returns.
  const stagedPayment = await prisma.$transaction(async (tx) => {
    const claim = await tx.payment.updateMany({
      where: {
        id: payment.id,
        status: "paid",
        paymobTransactionId: payment.paymobTransactionId,
      },
      data: {
        status: "refund_pending",
        refundRequestedCents: refundAmountCents,
        refundClaimedAt: null,
      },
    });

    if (claim.count !== 1) {
      const err = new Error("Payment is already being refunded or is no longer eligible for refund.");
      err.status = 409;
      throw err;
    }

    await tx.booking.update({
      where: { id: payment.bookingId },
      data: {
        status: "cancelled",
        paymentStatus: "refund_pending",
        cancellationReason: "manager",
      },
    });

    return tx.payment.findUnique({ where: { id: payment.id } });
  });

  // Outbox fast path: a failure remains refund_pending and is retried by the 60-second worker.
  const refundIssued = await attemptRefundSettlement(payment.id);

  const updatedPayment = refundIssued
    ? await prisma.payment.findUnique({ where: { id: payment.id } })
    : stagedPayment;

  return {
    ...updatedPayment,
    refundIssued,
    refundPending: !refundIssued,
  };
}
