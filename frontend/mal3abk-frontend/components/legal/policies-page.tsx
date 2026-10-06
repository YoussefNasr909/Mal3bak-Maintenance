"use client"

import { useState, useEffect } from "react"
import { CancellationTimeline } from "@/components/legal/cancellation-timeline"
import Link from "next/link"
import {
  ShieldCheck,
  FileText,
  Lock,
  RefreshCcw,
  CreditCard,
  Building2,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Mail,
  Phone,
  MapPin,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  Zap,
  Info,
} from "lucide-react"

import { HeaderLogo } from "@/components/branding/header-logo"
import { NavbarPreferenceControls } from "@/components/ui/navbar-preference-controls"
import { useLanguage } from "@/components/providers/language-provider"
import { useAuth } from "@/components/providers/auth-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import Footer from "@/components/landing/Footer"
import { cn } from "@/lib/utils"

export function PoliciesPageClient() {
  const { language, direction } = useLanguage()
  const { user } = useAuth()
  const isAr = language === "ar"
  const tr = (ar: string, en: string) => (isAr ? ar : en)

  const [activeSection, setActiveSection] = useState<string>("privacy")

  const effectiveRole = user?.role || null
  const homeHref =
    effectiveRole === "admin"
      ? "/dashboard/admin"
      : effectiveRole === "manager"
        ? "/dashboard/manager"
        : effectiveRole === "player"
          ? "/dashboard/player"
          : "/"

  const ArrowIcon = direction === "rtl" ? ArrowLeft : ArrowRight

  const tocItems = [
    {
      id: "privacy",
      title: tr("سياسة الخصوصية", "Privacy Policy"),
      icon: ShieldCheck,
      subsections: [
        tr("المعلومات التي نجمعها", "Information We Collect"),
        tr("كيفية استخدام البيانات", "How We Use Your Data"),
        tr("أمن المدفوعات والعملة (EGP)", "Paymob Payment Security & Currency (EGP)"),
        tr("حقوق المستخدم والاحتفاظ بالبيانات", "User Rights & Data Retention"),
      ],
    },
    {
      id: "refund",
      title: tr("سياسة الاسترجاع والإلغاء", "Refund & Cancellation Policy"),
      icon: RefreshCcw,
      subsections: [
        tr("نافذة الحجز المؤقت (5 دقائق)", "5-Minute Reservation Hold & Grace Window"),
        tr("جدول سياسة الإلغاء والاسترجاع", "Cancellation & Refund Timeline"),
        tr("عدم الحضور", "No-Show Policy"),
        tr("مدد الاسترداد حسب طريقة الدفع", "Refund Timelines by Payment Method"),
        tr("الأحوال الجوية والظروف الطارئة", "Inclement Weather & Force Majeure"),
        tr("حل النزاعات والدعم الفني", "Dispute Resolution & Support"),
        tr("القانون الحاكم", "Governing Law"),
      ],
    },
  ]

  // Track active section on scroll
  useEffect(() => {
    const handleScroll = () => {
      const privacyEl = document.getElementById("privacy")
      const refundEl = document.getElementById("refund")

      if (!privacyEl || !refundEl) return

      const scrollPos = window.scrollY + 160
      const refundTop = refundEl.offsetTop

      if (scrollPos >= refundTop) {
        setActiveSection("refund")
      } else {
        setActiveSection("privacy")
      }
    }

    window.addEventListener("scroll", handleScroll, { passive: true })
    handleScroll()
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  const scrollToAnchor = (id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY - 100
    window.scrollTo({ top, behavior: "smooth" })
    setActiveSection(id)
  }

  return (
    <div
      className={cn("min-h-screen bg-background text-foreground", direction === "rtl" ? "rtl" : "ltr")}
      dir={direction}
      suppressHydrationWarning
    >
      {/* Top Fixed Header */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-border/40 bg-background/90 backdrop-blur-xl supports-[backdrop-filter]:bg-background/82 dark:border-white/10 dark:bg-slate-950/78">
        <div className="container-responsive flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
          <Link href={homeHref} className="flex items-center gap-2 group">
            <HeaderLogo language={language as "ar" | "en"} priority className="h-10 w-[126px] sm:h-11 sm:w-[142px]" />
          </Link>

          <div className="flex items-center gap-3">
            <NavbarPreferenceControls />
            <Button
              variant="outline"
              size="sm"
              className="rounded-full text-xs font-semibold sm:text-sm"
              asChild
            >
              <Link href={homeHref} className="flex items-center gap-1.5">
                <span>{tr("الرئيسية", "Home")}</span>
                <ArrowIcon className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Header Section */}
      <div className="relative border-b border-border/40 bg-gradient-to-b from-primary/10 via-background to-background pt-28 pb-12 sm:pt-36 sm:pb-16">
        <div className="container-responsive px-4 sm:px-6">
          <div className="max-w-3xl space-y-4">
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary px-3 py-1 text-xs font-semibold gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              {tr("الشروط والسياسات القانونية", "Legal & Policies")}
            </Badge>

            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl text-foreground">
              {tr("سياسات منصة ملعبك", "Mal3bk Platform Policies")}
            </h1>

            <p className="text-base sm:text-lg text-muted-foreground leading-relaxed">
              {tr(
                "نلتزم في منصة ملعبك بالشفافية الكاملة وتوافق السياسات مع الأنظمة البرمجية الفعلية لمعالجة الحجوزات والمدفوعات الإلكترونية عبر Paymob وحماية بيانات اللاعبين والمنشآت الرياضية.",
                "At Mal3bk, we are committed to complete transparency, ensuring our policies strictly match our technical state machine for booking holds, Paymob payment processing, and player data protection.",
              )}
            </p>

            <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2">
              <Clock className="h-3.5 w-3.5 text-primary" />
              <span>{tr("آخر تحديث: سبتمبر 2026", "Last Updated: September 2026")}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content with 2-Column Layout on Desktop */}
      <main className="container-responsive px-4 sm:px-6 py-10 lg:py-16">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-12">
          {/* Table of Contents (Sticky Sidebar on Desktop, Top on Mobile) */}
          <aside className="lg:col-span-4 xl:col-span-3">
            <div className="sticky top-28 space-y-6">
              <Card className="border border-border/60 bg-card/80 backdrop-blur-sm shadow-sm">
                <CardContent className="p-4 sm:p-5 space-y-3">
                  <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground px-2">
                    {tr("فهرس السياسات", "Table of Contents")}
                  </div>

                  <nav className="space-y-1">
                    {tocItems.map((item) => {
                      const Icon = item.icon
                      const isActive = activeSection === item.id

                      return (
                        <div key={item.id} className="space-y-1">
                          <button
                            onClick={() => scrollToAnchor(item.id)}
                            className={cn(
                              "w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 text-start",
                              isActive
                                ? "bg-primary text-primary-foreground shadow-sm"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Icon className="h-4 w-4 shrink-0" />
                              <span className="truncate">{item.title}</span>
                            </div>
                            {direction === "rtl" ? (
                              <ChevronLeft className="h-4 w-4 shrink-0 opacity-70" />
                            ) : (
                              <ChevronRight className="h-4 w-4 shrink-0 opacity-70" />
                            )}
                          </button>

                          {/* Subsections quick view */}
                          <ul className="ps-8 pe-2 py-1 space-y-1 text-xs text-muted-foreground hidden sm:block">
                            {item.subsections.map((sub, i) => (
                              <li key={i} className="list-disc list-inside truncate py-0.5 opacity-80 hover:opacity-100">
                                {sub}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )
                    })}
                  </nav>

                  {/* Need Help Box */}
                  <div className="pt-4 border-t border-border/50">
                    <div className="rounded-xl border border-border/60 bg-muted/40 p-3 space-y-2">
                      <p className="text-xs font-semibold text-foreground">
                        {tr("هل لديك استفسار قانوني؟", "Have legal questions?")}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {tr("فريق الدعم القانوني والتقني جاهز لمساعدتك.", "Our legal and support teams are available to assist you.")}
                      </p>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="w-full text-xs h-8"
                        asChild
                      >
                        <a href="mailto:mal3bkk@gmail.com">
                          <Mail className="h-3 w-3 me-1.5" />
                          mal3bkk@gmail.com
                        </a>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </aside>

          {/* Policy Text Content */}
          <div className="lg:col-span-8 xl:col-span-9 space-y-16">
            {/* 1. PRIVACY POLICY SECTION */}
            <section
              id="privacy"
              className="scroll-mt-28 rounded-3xl border border-border/60 bg-card p-6 sm:p-8 lg:p-10 shadow-smooth"
            >
              <div className="flex items-center gap-3 border-b border-border/50 pb-6 mb-8">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold tracking-tight sm:text-3xl text-foreground">
                    {tr("سياسة الخصوصية", "Privacy Policy")}
                  </h2>
                  <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                    {tr("جمع واستخدام وحماية البيانات ومعايير أمن المعاملات المالية", "Data collection, operational usage, and financial transaction security standards")}
                  </p>
                </div>
              </div>

              <div className="prose prose-sm sm:prose-base dark:prose-invert max-w-none space-y-8 text-foreground/90 leading-relaxed">
                <div>
                  <h3 className="text-lg font-bold text-foreground">
                    {tr("١. مقدمة ونطاق التطبيق", "1. Introduction & Scope")}
                  </h3>
                  <p className="text-muted-foreground">
                    {tr(
                      "تحترم منصة «ملعبك» (Mal3bk.com) خصوصيتك وتلتزم بحماية بياناتك الشخصية وفقاً للتشريعات والقوانين المنظمة لحماية البيانات في جمهورية مصر العربية. تنطبق هذه السياسة على جميع مستخدمي المنصة (اللاعبين، ومديري الملاعب، والمشرفين) عند تصفح المنصة أو إجراء الحجوزات أو سداد المدفوعات.",
                      "Mal3bk (Mal3bk.com) respects your privacy and is committed to protecting your personal data in compliance with Egyptian data protection regulations. This policy applies to all platform users (players, court managers, and administrators) browsing, reserving sports courts, or completing digital transactions.",
                    )}
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-foreground">
                    {tr("٢. المعلومات التي نقوم بجمعها", "2. Information We Collect")}
                  </h3>
                  <ul className="list-disc ps-5 space-y-2 text-muted-foreground">
                    <li>
                      <strong className="text-foreground">{tr("بيانات الحساب الشخصي:", "Personal Account Details:")}</strong>{" "}
                      {tr("الاسم الكامل، عنوان البريد الإلكتروني، رقم الهاتف المحمول، وكلمة المرور المشفرة (تشفير آمن بنظام bcrypt).", "Full name, email address, mobile phone number, and bcrypt-hashed credentials.")}
                    </li>
                    <li>
                      <strong className="text-foreground">{tr("بيانات الحجوزات والمعاملات:", "Booking & Transaction Data:")}</strong>{" "}
                      {tr("تواريخ وفترات الحجز، الملاعب المحجوزة، رموز الدخول اللحظية (QR Codes المكونة من ٨ خانات)، وملاحظات الحجز.", "Reservation dates and time slots, selected sports venues, instant 8-character QR entry codes, and booking notes.")}
                    </li>
                    <li>
                      <strong className="text-foreground">{tr("بيانات الاستخدام والشبكة:", "Usage & Network Information:")}</strong>{" "}
                      {tr("عنوان بروتوكول الإنترنت (IP)، نوع المتصفح، سجلات الأخطاء والتدقيق (Audit Logs)، وتفضيلات اللغة والمظهر.", "IP address, browser type, operational audit logs, language settings, and dark/light theme preferences.")}
                    </li>
                  </ul>
                </div>

                <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 not-prose space-y-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-primary">
                    <Lock className="h-4 w-4" />
                    <span>{tr("أمن المدفوعات والعملة الرسمية (EGP)", "Payment Gateway Security & Official Currency (EGP)")}</span>
                  </div>
                  <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                    {tr(
                      "تتم جميع المعاملات المالية الإلكترونية حصرياً بالجنيه المصري (EGP / ج.م) عبر بوابة الدفع المعتمدة رسمياً من البنك المركزي المصري (Paymob). منصة ملعبك لا تستقبل ولا تخزن أي أرقام بطاقات ائتمانية أو رموز CVV على خوادمها، وتتم عمليات الدفع عبر قنوات مشفرة بمعيار الأمان العالمي PCI-DSS مع توثيق التوقيع الرقمي (HMAC Signature Verification).",
                      "All digital financial transactions are billed and processed strictly in Egyptian Pounds (EGP / ج.م) through Paymob, a PCI-DSS certified gateway licensed by the Central Bank of Egypt. Mal3bk does not store credit card numbers or CVV codes on its servers. All callbacks are authenticated via cryptographically verified HMAC signatures.",
                    )}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-xs font-semibold text-foreground">
                    <span className="inline-flex items-center gap-1 rounded-lg bg-card px-2.5 py-1 border border-border/60">
                      <CreditCard className="h-3.5 w-3.5 text-primary" />
                      {tr("البطاقات البنكية (Visa / Mastercard)", "Bank Cards (Visa / Mastercard)")}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-lg bg-card px-2.5 py-1 border border-border/60">
                      <Zap className="h-3.5 w-3.5 text-emerald-600" />
                      {tr("المحافظ الإلكترونية (Vodafone Cash, Orange, Etisalat, WE)", "Mobile Wallets (Vodafone Cash, Orange, Etisalat, WE)")}
                    </span>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-foreground">
                    {tr("٣. كيف نستخدم معلوماتك", "3. How We Use Your Information")}
                  </h3>
                  <p className="text-muted-foreground">
                    {tr(
                      "نستخدم البيانات المجمعة للأغراض التشغيلية المرتبطة بخدمة الحجز والدفع فقط:",
                      "We use collected data solely for core operational, reservation, and payment purposes:",
                    )}
                  </p>
                  <ul className="list-disc ps-5 space-y-2 text-muted-foreground">
                    <li>{tr("تأكيد حجوزات الملاعب وإصدار تصاريح الدخول اللحظية ورموز التحقق الرقمية.", "Confirming court reservations and generating instant QR entry verification codes.")}</li>
                    <li>{tr("إرسال الإشعارات التشغيلية والتذكيرات بالمباريات وتحديثات الاسترداد المالي.", "Sending operational updates, match reminders, and automated refund notifications.")}</li>
                    <li>{tr("منع الحجز المزدوج وضمان تسوية المدفوعات المعلقة بدقة وموثوقية.", "Preventing double-bookings and maintaining atomic state synchronization during payment checkout.")}</li>
                  </ul>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-foreground">
                    {tr("٤. حقوقك والتحكم في بياناتك", "4. Your Rights & Data Retention")}
                  </h3>
                  <p className="text-muted-foreground">
                    {tr(
                      "يحق لك في أي وقت مراجعة بياناتك، تعديل حسابك، أو طلب حذف بياناتك من خلال التواصل معنا عبر mal3bkk@gmail.com. نحتفظ بسجلات المعاملات المالية وسجلات التدقيق الضريبية للمدة المحددة بموجب القوانين واللوائح المصرية المنظمة للأنشطة التجارية والمالية.",
                      "You have the right to access, update, or request the deletion of your personal data by contacting mal3bkk@gmail.com. Financial transaction ledgers and audit records are retained for the duration mandated by applicable Egyptian commercial and tax legislation.",
                    )}
                  </p>
                </div>
              </div>
            </section>

            {/* 2. REFUND POLICY SECTION */}
            <section
              id="refund"
              className="scroll-mt-28 rounded-3xl border border-border/60 bg-card p-6 sm:p-8 lg:p-10 shadow-smooth"
            >
              <div className="flex items-center gap-3 border-b border-border/50 pb-6 mb-8">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <RefreshCcw className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold tracking-tight sm:text-3xl text-foreground">
                    {tr("سياسة الاسترجاع والإلغاء", "Refund & Cancellation Policy")}
                  </h2>
                  <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                    {tr("شروط الاسترداد التلقائي، قواعد نافذة الحجز المؤقت، وآليات حماية المدفوعات", "Automated refund rules, reservation hold mechanics, and transactional payment protections")}
                  </p>
                </div>
              </div>

              <div className="prose prose-sm sm:prose-base dark:prose-invert max-w-none space-y-8 text-foreground/90 leading-relaxed">
                <div>
                  <h3 className="text-lg font-bold text-foreground">
                    {tr("١. نافذة الحجز المؤقت (٥ دقائق) وفترة السماح التقنية", "1. 5-Minute Reservation Hold & In-Flight Grace Window")}
                  </h3>
                  <p className="text-muted-foreground">
                    {tr(
                      "عند بدء عملية حجز ملعب يتطلب دفعاً إلكترونياً، يتم حجز الفترة الزمنية مؤقتاً لصالحك حصرياً لمدة ٥ دقائق (٣٠٠ ثانية) عبر قفل ذرّي في قاعدة البيانات لمنع أي تعارض في الحجز. إذا لم يتم إتمام الدفع قبل انتهاء المؤقت، يتم تحرير الفترة تلقائياً للجمهور دون أي التزام مالي.",
                      "When initiating an online reservation, the court slot is locked exclusively for you for 5 minutes (300 seconds) via an atomic database hold to prevent double-booking. If payment is not completed before the countdown expires, the slot is automatically released to the public with no financial charge.",
                    )}
                  </p>
                  <div className="rounded-2xl border border-border/60 bg-muted/40 p-4 not-prose mt-3 space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-xs text-foreground">
                      <Info className="h-4 w-4 text-primary" />
                      <span>{tr("فترة السماح للمدفوعات الجارية (In-Flight Grace):", "In-Flight Payment Grace Window:")}</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {tr(
                        "إذا قمت بفتح صفحة الدفع عبر Paymob قبل نفاد الـ ٥ دقائق، يمنح النظام فترة سماح إضافية مدتها دقيقتان لتأكيد استلام الويب هوك (Webhook) من بوابة الدفع وتجنب إلغاء حجزك أثناء إجراء المعاملة البنكية.",
                        "If you launch a Paymob checkout session before the 5-minute timer expires, our backend reserves an extra 2-minute grace window to receive the settlement webhook before expiring the slot, protecting in-flight bank transactions.",
                      )}
                    </p>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-foreground">
                    {tr("2. جدول سياسة الإلغاء والاسترجاع", "2. Cancellation & Refund Timeline")}
                  </h3>
                  <p className="text-muted-foreground mb-4">
                    {tr(
                      "تخضع عمليات الإلغاء والاسترداد المالي للقواعد التالية وفقاً للوقت المتبقي قبل بدء المباراة:",
                      "Refund eligibility is determined by how much time remains before your scheduled match:",
                    )}
                  </p>

                  <div className="not-prose rounded-2xl border border-border/60 bg-muted/30 p-5">
                    <CancellationTimeline />
                  </div>

                  <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3.5 text-xs flex items-start gap-2.5 not-prose mt-4">
                    <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
                    <p className="text-muted-foreground">
                      <strong className="text-foreground">
                        {tr("استرداد تلقائي عند تعارض الدفع المتأخر:", "Late Settlement Auto-Refund:")}
                      </strong>{" "}
                      {tr(
                        "إذا تم سداد الدفعة بنجاح بعد انتهاء نافذة الحجز المؤقت وكان الملعب قد حُجز للاعب آخر، يقوم النظام فوراً برد المبلغ 100% تلقائياً دون أي تدخل منك.",
                        "If your payment settles after the reservation hold expires and the slot was taken by another player, our system automatically issues a 100% refund.",
                      )}
                    </p>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-foreground">
                    {tr("3. سياسة عدم الحضور", "3. No-Show Policy")}
                  </h3>
                  <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3.5 text-xs text-destructive flex items-start gap-2.5 not-prose">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <p>
                      {tr(
                        "إذا لم تقم بتسجيل الدخول في الملعب خلال فترة الحجز المحددة، يُعتبر الحجز عدم حضور ولا يحق لك استرداد المبلغ المدفوع.",
                        "If you do not check in at the venue during your scheduled booking slot, the booking is marked as a no-show and no refund will be issued.",
                      )}
                    </p>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-foreground">
                    {tr("4. مدد الاسترداد حسب طريقة الدفع", "4. Refund Timelines by Payment Method")}
                  </h3>
                  <p className="text-muted-foreground">
                    {tr(
                      "يتم إرجاع المبلغ المسترد تلقائياً إلى نفس طريقة الدفع الأصلية التي استخدمتها عند الحجز. المدد التالية تقديرية وقد تختلف حسب الجهة المصدرة:",
                      "Refunds are returned automatically to the same payment method you originally used. The following timelines are estimates and may vary depending on your payment provider:",
                    )}
                  </p>
                  <ul className="list-disc ps-5 space-y-2 text-muted-foreground">
                    <li>
                      <strong className="text-foreground">{tr("المحافظ الإلكترونية (فودافون كاش، أورنج، اتصالات، وي):", "Mobile Wallets (Vodafone Cash, Orange, Etisalat, WE):")}</strong>{" "}
                      {tr("يتم رد الرصيد إلى محفظتك الإلكترونية عادةً خلال نفس يوم العمل.", "Typically credited back to your mobile wallet within the same business day.")}
                    </li>
                    <li>
                      <strong className="text-foreground">{tr("البطاقات البنكية (فيزا / ماستركارد):", "Bank Cards (Visa / Mastercard):")}</strong>{" "}
                      {tr("تتم المعالجة عبر Paymob وقد تستغرق من 3 إلى 14 يوم عمل لتظهر في كشف حساب بطاقتك، وذلك وفقاً لسياسات البنك المصدر للبطاقة.", "Processed through Paymob and may take 3 to 14 business days to appear on your card statement, depending on your issuing bank's policies.")}
                    </li>
                  </ul>
                  <p className="text-xs text-muted-foreground mt-2 italic">
                    {tr(
                      "ملاحظة: لا يتم رد المبالغ عبر طريقة دفع مختلفة عن الطريقة الأصلية. لا يمكن طلب الاسترداد بعد مرور 90 يوماً من تاريخ المعاملة الأصلية.",
                      "Note: Refunds cannot be issued to a different payment method than the one originally used. Refund requests cannot be processed more than 90 days after the original transaction date.",
                    )}
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-foreground">
                    {tr("5. سوء الأحوال الجوية والظروف القاهرة", "5. Inclement Weather & Force Majeure")}
                  </h3>
                  <p className="text-muted-foreground">
                    {tr(
                      "في حال تعذر إقامة المباراة في الملاعب المفتوحة بسبب الظروف الجوية القاسية (أمطار غزيرة، عواصف) أو انقطاع التيار الكهربائي العام، يحق للاعب إعادة جدولة المباراة لموعد آخر مجاناً أو طلب استرداد كامل المبلغ المدفوع (١٠٠٪) بعد اعتماد إدارة الملعب.",
                      "If an outdoor match cannot be played due to severe inclement weather (heavy rain, sandstorms) or general venue power failure, players may choose between a free reschedule or a 100% full refund upon venue confirmation.",
                    )}
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-foreground">
                    {tr("6. حل النزاعات وخدمة العملاء", "6. Dispute Resolution & Support")}
                  </h3>
                  <p className="text-muted-foreground">
                    {tr(
                      "إذا واجهتك أي مشكلة في استرداد مدفوعاتك أو حدث خلاف مع إدارة الملعب، يرجى التواصل فوراً مع مركز خدمة عملاء ملعبك عبر البريد الإلكتروني mal3bkk@gmail.com أو الهاتف +20 11 31734350 مع تزويدنا برقم الحجز ورقم مرجع الدفع (Paymob Transaction ID).",
                      "If you encounter any delay in refund settlement or require support regarding a reservation dispute, contact Mal3bk support immediately via mal3bkk@gmail.com or +20 11 31734350 with your Booking ID and Paymob Transaction ID.",
                    )}
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-foreground">
                    {tr("7. القانون الحاكم وتاريخ السريان", "7. Governing Law & Effective Date")}
                  </h3>
                  <p className="text-muted-foreground">
                    {tr(
                      "تخضع هذه السياسة لقوانين جمهورية مصر العربية وتُفسَّر وفقاً لها. تسري هذه السياسة اعتباراً من سبتمبر 2026.",
                      "This policy is governed by and construed in accordance with the laws of the Arab Republic of Egypt. This policy is effective as of September 2026.",
                    )}
                  </p>
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>

      {/* Footer */}
      <Footer homeHref={homeHref} />
    </div>
  )
}
