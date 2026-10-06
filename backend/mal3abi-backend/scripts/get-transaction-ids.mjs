import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const payments = await prisma.payment.findMany({
  orderBy: { createdAt: 'desc' },
  take: 10,
  select: {
    id: true,
    paymobTransactionId: true,
    paymobOrderId: true,
    paymentMethod: true,
    status: true,
    amountCents: true,
    currency: true,
    createdAt: true,
    booking: { select: { id: true, status: true } },
  },
});

if (payments.length === 0) {
  console.log('\n⚠️  No payments found in the database yet.');
  console.log('   Complete a test payment first, then re-run this script.\n');
} else {
  console.log(`\n=== ${payments.length} MOST RECENT PAYMENT(S) ===\n`);
  payments.forEach((p, i) => {
    console.log(`--- Payment #${i + 1} ---`);
    console.log(`  🆔 Paymob Transaction ID : ${p.paymobTransactionId || '(not yet set)'}`);
    console.log(`  📦 Paymob Order ID       : ${p.paymobOrderId || '(not yet set)'}`);
    console.log(`  💳 Payment Method        : ${p.paymentMethod || 'N/A'}`);
    console.log(`  📊 Status                : ${p.status}`);
    console.log(`  💰 Amount                : ${(p.amountCents / 100).toFixed(2)} ${p.currency}`);
    console.log(`  📅 Created               : ${p.createdAt}`);
    console.log(`  🎫 Booking ID            : ${p.booking?.id || 'N/A'}`);
    console.log(`  🎫 Booking Status        : ${p.booking?.status || 'N/A'}`);
    console.log('');
  });

  console.log('════════════════════════════════════════════════════════════');
  console.log('  Copy the "Paymob Transaction ID" values above to send');
  console.log('  to the Paymob Integration Team as proof of test payments.');
  console.log('════════════════════════════════════════════════════════════\n');
}

await prisma.$disconnect();
