import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { createRateLimiter } from "../../utils/rateLimit.js";
import {
  createCheckoutSession,
  initiateWalletPayment,
  handlePaymobWebhook,
  getPaymentStatus,
  refundPayment,
  getDeadLetterQueueStatus,
  retryDeadLetterQueue,
  reconcilePendingPaymobPayments,
  getPaymobOperationsStatus,
} from "./payments.controller.js";

const router = Router();

// Rate limit: 5 payment-initiation requests per 15 min per IP (prevents abuse)
const paymentInitLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    message: "Too many payment attempts. Please try again after 15 minutes.",
  },
});

// Protected: Player creates a payment checkout session for a court booking
router.post("/create-checkout-session", requireAuth, paymentInitLimiter, createCheckoutSession);

// Protected: Player initiates direct Paymob Mobile Wallet payment
router.post("/wallet/initiate", requireAuth, paymentInitLimiter, initiateWalletPayment);

// Public: Paymob Webhook Callback Endpoint (HMAC SHA-512 validated)
router.post("/webhook", handlePaymobWebhook);

// Protected: User queries payment and booking status
router.get("/status/:bookingId", requireAuth, getPaymentStatus);

// Protected: Admin/Manager processes payment refund
router.post("/refund/:paymentId", requireAuth, requireRole("admin", "manager"), refundPayment);

// Protected: Admin DLQ Monitoring & Manual Trigger
router.get("/admin/dlq", requireAuth, requireRole("admin"), getDeadLetterQueueStatus);
router.post("/admin/dlq/retry", requireAuth, requireRole("admin"), retryDeadLetterQueue);
router.post("/admin/reconcile-pending", requireAuth, requireRole("admin"), reconcilePendingPaymobPayments);
router.get("/admin/operations-status", requireAuth, requireRole("admin"), getPaymobOperationsStatus);

export default router;
