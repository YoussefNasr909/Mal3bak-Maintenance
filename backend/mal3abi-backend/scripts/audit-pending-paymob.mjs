import "dotenv/config";
import { prisma } from "../src/db/prisma.js";
import {
  inquireLatestTransactionByOrder,
  inquireTransaction,
} from "../src/modules/payments/paymob.service.js";

// Read-only production incident audit. It intentionally prints no credentials, client secrets,
// raw callback payloads, or card data. Run it on the Hostinger backend with the production .env:
//   PAYMOB_AUDIT_LIMIT=500 node scripts/audit-pending-paymob.mjs
const limit = Math.min(Math.max(Number(process.env.PAYMOB_AUDIT_LIMIT) || 100, 1), 1000);

function providerSummary(transaction) {
  if (!transaction) return null;
  return {
    transactionId: transaction.id ? String(transaction.id) : null,
    orderId: transaction.order?.id ? String(transaction.order.id) : null,
    success: transaction.success === true,
    pending: transaction.pending === true,
    refunded: transaction.is_refunded === true,
    voided: transaction.is_voided === true,
    errorOccurred: transaction.error_occured === true,
    amountCents: Number(transaction.amount_cents),
    currency: transaction.currency || null,
    createdAt: transaction.created_at || null,
  };
}

async function getProviderTransaction(payment) {
  if (payment.paymobTransactionId) {
    return inquireTransaction(payment.paymobTransactionId);
  }
  return inquireLatestTransactionByOrder({
    orderId: payment.paymobOrderId,
    merchantOrderId: payment.merchantReference,
  });
}

async function main() {
  const payments = await prisma.payment.findMany({
    where: {
      provider: "paymob",
      status: "pending",
      OR: [
        { paymobOrderId: { not: null } },
        { merchantReference: { not: null } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      bookingId: true,
      paymobOrderId: true,
      merchantReference: true,
      paymobTransactionId: true,
      amountCents: true,
      currency: true,
      hmacVerified: true,
      createdAt: true,
      booking: {
        select: {
          status: true,
          paymentStatus: true,
          date: true,
          startTime: true,
          endTime: true,
        },
      },
    },
  });

  const records = [];
  for (const payment of payments) {
    try {
      const provider = await getProviderTransaction(payment);
      records.push({
        paymentId: payment.id,
        bookingId: payment.bookingId,
        local: {
          paymentStatus: "pending",
          bookingStatus: payment.booking.status,
          bookingPaymentStatus: payment.booking.paymentStatus,
          paymobOrderId: payment.paymobOrderId,
          merchantReference: payment.merchantReference,
          paymobTransactionId: payment.paymobTransactionId,
          amountCents: payment.amountCents,
          currency: payment.currency,
          hmacVerified: payment.hmacVerified,
          createdAt: payment.createdAt,
          bookingSlot: `${payment.booking.date} ${payment.booking.startTime}-${payment.booking.endTime}`,
        },
        provider: providerSummary(provider),
        inquiryError: null,
      });
    } catch (error) {
      records.push({
        paymentId: payment.id,
        bookingId: payment.bookingId,
        local: {
          paymentStatus: "pending",
          bookingStatus: payment.booking.status,
          bookingPaymentStatus: payment.booking.paymentStatus,
          paymobOrderId: payment.paymobOrderId,
          merchantReference: payment.merchantReference,
          paymobTransactionId: payment.paymobTransactionId,
          amountCents: payment.amountCents,
          currency: payment.currency,
          hmacVerified: payment.hmacVerified,
          createdAt: payment.createdAt,
          bookingSlot: `${payment.booking.date} ${payment.booking.startTime}-${payment.booking.endTime}`,
        },
        provider: null,
        inquiryError: error?.message || String(error),
      });
    }
  }

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    scanned: records.length,
    limit,
    records,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error("Paymob pending-payment audit failed:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
