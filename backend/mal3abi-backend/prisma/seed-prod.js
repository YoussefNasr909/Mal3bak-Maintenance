/**
 * Production Seed Script — seed-prod.js
 *
 * Creates ONLY essential operational data for a clean production database:
 * 1. Admin account (with a secure password from env)
 *
 * Usage:
 *   PROD_ADMIN_EMAIL=admin@mal3bk.com PROD_ADMIN_PASSWORD="YourSecurePass!" node prisma/seed-prod.js
 *
 * Safety:
 *   - Requires NODE_ENV=production OR ALLOW_PROD_SEED=true
 *   - Will NOT run without PROD_ADMIN_EMAIL and PROD_ADMIN_PASSWORD
 *   - Uses upsert, so it's safe to re-run
 *   - Does NOT create dummy players, courts, bookings, or test data
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.PROD_ADMIN_EMAIL;
  const adminPassword = process.env.PROD_ADMIN_PASSWORD;
  const adminName = process.env.PROD_ADMIN_NAME || "Mal3bk Admin";
  const adminPhone = process.env.PROD_ADMIN_PHONE || "01000000000";

  if (!adminEmail || !adminPassword) {
    console.error(
      "PROD_ADMIN_EMAIL and PROD_ADMIN_PASSWORD are required.\n" +
      "Usage: PROD_ADMIN_EMAIL=admin@mal3bk.com PROD_ADMIN_PASSWORD=\"YourSecurePass!\" node prisma/seed-prod.js"
    );
    process.exit(1);
  }

  if (adminPassword.length < 8) {
    console.error("PROD_ADMIN_PASSWORD must be at least 8 characters.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      name: adminName,
      email: adminEmail,
      phone: adminPhone,
      password: passwordHash,
      role: "admin",
      isActive: true,
    },
    update: {
      name: adminName,
      password: passwordHash,
      role: "admin",
      isActive: true,
      deletedAt: null,
    },
  });

  console.log(`✅ Admin account ready: ${admin.email} (id: ${admin.id})`);
  console.log("ℹ️  Courts and managers can be created through the admin dashboard.");
}

main()
  .catch((error) => {
    console.error("Production seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
