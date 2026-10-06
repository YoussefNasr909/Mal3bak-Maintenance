"use client"

import { CheckCircle2, XCircle, Clock, RefreshCcw, Info } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useLanguage } from "@/components/providers/language-provider"
import { cn } from "@/lib/utils"

interface CancellationTimelineProps {
  /** Render a smaller variant suitable for embedding in checkout pages */
  compact?: boolean
  /** Additional CSS classes on the root container */
  className?: string
}

/**
 * Reusable vertical-timeline component that summarises the Mal3bk cancellation
 * and refund policy at a glance.
 *
 * Two display sizes:
 *  - **default** — used on the `/policies` page inside the #refund section
 *  - **compact** — used on the reservation-hold / checkout page
 *
 * Bilingual (EN / AR) via the language provider.  RTL-aware.
 */
export function CancellationTimeline({
  compact = false,
  className,
}: CancellationTimelineProps) {
  const { language, direction } = useLanguage()
  const isAr = language === "ar"
  const tr = (ar: string, en: string) => (isAr ? ar : en)

  const steps = [
    {
      id: "eligible",
      icon: CheckCircle2,
      label: tr(
        "أكثر من 6 ساعات قبل بداية المباراة",
        "6+ hours before match start",
      ),
      description: tr(
        "يحق لك إلغاء الحجز واسترداد كامل المبلغ المدفوع تلقائياً.",
        "You may cancel your booking and receive a full refund automatically.",
      ),
      badge: tr("استرجاع 100%", "100% Refund"),
      badgeVariant: "success" as const,
      dotColor: "bg-emerald-500",
      lineColor: "from-emerald-500 to-red-400",
    },
    {
      id: "ineligible",
      icon: XCircle,
      label: tr(
        "أقل من 6 ساعات قبل المباراة أو عدم الحضور",
        "Under 6 hours before match or no-show",
      ),
      description: tr(
        "لا يمكن إلغاء الحجز أو استرداد المبلغ. عدم الحضور وعدم تسجيل الدخول يُعتبر أيضاً غير قابل للاسترجاع.",
        "Cancellation is blocked and no refund is issued. Failure to check in is also non-refundable.",
      ),
      badge: tr("غير قابل للاسترجاع", "Non-refundable"),
      badgeVariant: "destructive" as const,
      dotColor: "bg-red-500",
      lineColor: null,
    },
  ]

  return (
    <div className={cn("relative", className)} dir={direction}>
      {/* Header — hidden in compact mode since the parent provides context */}
      {!compact && (
        <div className="flex items-center gap-2.5 mb-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Clock className="h-4.5 w-4.5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-foreground leading-tight">
              {tr("جدول سياسة الإلغاء", "Cancellation Policy Timeline")}
            </h4>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {tr(
                "تعرّف على شروط الاسترجاع قبل تأكيد الحجز",
                "Know your refund terms before confirming",
              )}
            </p>
          </div>
        </div>
      )}

      {/* Timeline Steps */}
      <div className="relative">
        {steps.map((step, index) => {
          const Icon = step.icon
          const isLast = index === steps.length - 1

          return (
            <div
              key={step.id}
              className={cn(
                "relative flex gap-3.5",
                !isLast && (compact ? "pb-4" : "pb-6"),
              )}
            >
              {/* Vertical line + dot */}
              <div className="relative flex flex-col items-center">
                {/* Dot */}
                <div
                  className={cn(
                    "relative z-10 flex items-center justify-center rounded-full border-2 border-background shadow-sm",
                    step.dotColor,
                    compact ? "h-7 w-7" : "h-9 w-9",
                  )}
                >
                  <Icon
                    className={cn(
                      "text-white",
                      compact ? "h-3.5 w-3.5" : "h-4 w-4",
                    )}
                  />
                </div>

                {/* Connecting line */}
                {!isLast && step.lineColor && (
                  <div
                    className={cn(
                      "w-0.5 flex-1 bg-gradient-to-b rounded-full mt-1",
                      step.lineColor,
                    )}
                  />
                )}
              </div>

              {/* Content */}
              <div className={cn("flex-1 min-w-0", compact ? "pt-0.5" : "pt-1")}>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "font-semibold text-foreground leading-snug",
                      compact ? "text-xs" : "text-sm",
                    )}
                  >
                    {step.label}
                  </span>
                  <Badge
                    variant={
                      step.badgeVariant === "success" ? "default" : "destructive"
                    }
                    className={cn(
                      "shrink-0 font-bold",
                      compact ? "text-[10px] px-1.5 py-0" : "text-xs px-2 py-0.5",
                      step.badgeVariant === "success" &&
                        "bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20",
                    )}
                  >
                    {step.badge}
                  </Badge>
                </div>

                {!compact && (
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {step.description}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer note */}
      <div
        className={cn(
          "flex items-start gap-2 rounded-xl border border-border/60 bg-muted/40",
          compact ? "p-2.5 mt-2" : "p-3.5 mt-3",
        )}
      >
        <RefreshCcw
          className={cn(
            "shrink-0 text-primary mt-0.5",
            compact ? "h-3 w-3" : "h-3.5 w-3.5",
          )}
        />
        <p
          className={cn(
            "text-muted-foreground leading-relaxed",
            compact ? "text-[10px]" : "text-xs",
          )}
        >
          {tr(
            "يتم إرجاع المبلغ تلقائياً إلى نفس طريقة الدفع الأصلية (البطاقة البنكية أو المحفظة الإلكترونية) عبر Paymob.",
            "Refunds are automatically issued to your original payment method (Bank Card or Mobile Wallet) via Paymob.",
          )}
        </p>
      </div>

      {/* Manager cancellation note — full mode only */}
      {!compact && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3.5 mt-3">
          <Info className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong className="text-foreground">
              {tr(
                "إلغاء من إدارة الملعب:",
                "Venue / Manager Cancellation:",
              )}
            </strong>{" "}
            {tr(
              "إذا قام مدير الملعب بإلغاء حجزك لأي سبب تشغيلي، يتم استرداد المبلغ المدفوع بالكامل (100%) تلقائياً ودون أي خصومات — بغض النظر عن الوقت المتبقي.",
              "If the venue or manager cancels your booking for any operational reason, a 100% full refund is automatically issued regardless of how much time remains before the match.",
            )}
          </p>
        </div>
      )}
    </div>
  )
}
