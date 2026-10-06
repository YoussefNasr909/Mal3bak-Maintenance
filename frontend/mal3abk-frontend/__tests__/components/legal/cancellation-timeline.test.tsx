import { render, screen } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { CancellationTimeline } from "@/components/legal/cancellation-timeline"

let currentLanguage = "en"
let currentDirection = "ltr"

vi.mock("@/components/providers/language-provider", () => ({
  useLanguage: () => ({
    language: currentLanguage,
    direction: currentDirection,
    t: (key: string) => key,
  }),
}))

describe("CancellationTimeline", () => {
  it("renders default mode with title, 6h cutoff rule, and payment method disclaimer in English", () => {
    currentLanguage = "en"
    currentDirection = "ltr"

    const { container } = render(<CancellationTimeline />)

    expect(screen.getByText("Cancellation Policy Timeline")).toBeInTheDocument()
    expect(screen.getByText("6+ hours before match start")).toBeInTheDocument()
    expect(screen.getByText("100% Refund")).toBeInTheDocument()
    expect(screen.getByText("Under 6 hours before match or no-show")).toBeInTheDocument()
    expect(screen.getByText("Non-refundable")).toBeInTheDocument()
    expect(screen.getByText(/original payment method/i)).toBeInTheDocument()
    expect(screen.getByText(/venue or manager cancels/i)).toBeInTheDocument()
    expect(container.firstChild).toHaveAttribute("dir", "ltr")
  })

  it("renders compact mode hiding the standalone header", () => {
    currentLanguage = "en"
    currentDirection = "ltr"

    render(<CancellationTimeline compact />)

    expect(screen.queryByText("Cancellation Policy Timeline")).not.toBeInTheDocument()
    expect(screen.getByText("6+ hours before match start")).toBeInTheDocument()
    expect(screen.getByText("100% Refund")).toBeInTheDocument()
    expect(screen.getByText("Under 6 hours before match or no-show")).toBeInTheDocument()
    expect(screen.getByText("Non-refundable")).toBeInTheDocument()
  })

  it("renders Arabic text and RTL direction when language is Arabic", () => {
    currentLanguage = "ar"
    currentDirection = "rtl"

    const { container } = render(<CancellationTimeline />)

    expect(screen.getByText("جدول سياسة الإلغاء")).toBeInTheDocument()
    expect(screen.getByText("أكثر من 6 ساعات قبل بداية المباراة")).toBeInTheDocument()
    expect(screen.getByText("استرجاع 100%")).toBeInTheDocument()
    expect(screen.getByText("أقل من 6 ساعات قبل المباراة أو عدم الحضور")).toBeInTheDocument()
    expect(screen.getByText("غير قابل للاسترجاع")).toBeInTheDocument()
    expect(container.firstChild).toHaveAttribute("dir", "rtl")
  })
})
