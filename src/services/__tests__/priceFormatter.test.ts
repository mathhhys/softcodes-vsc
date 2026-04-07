import { describe, test, expect } from "vitest"
import { formatPrice } from "../priceFormatter"

describe("priceFormatter", () => {
	test("formats credit-based providers as credits", () => {
		expect(formatPrice("softcodes/openrouter", 10)).toBe("10 credits")
		expect(formatPrice("softcodes", 5)).toBe("5 credits")
		expect(formatPrice("openrouter", 3)).toBe("3 credits")
		expect(formatPrice("softcodes/openrouter", 0)).toBe("0 credits")
	})

	test("formats other providers as USD with 2 decimals", () => {
		expect(formatPrice("openai", 1)).toBe("$1.00")
		expect(formatPrice("anthropic", 2.3456)).toBe("$2.35")
		expect(formatPrice("google", 0.5)).toBe("$0.50")
	})

	test("handles edge cases gracefully", () => {
		expect(formatPrice("any-provider", 0)).toBe("$0.00")
		expect(formatPrice("softcodes", 0)).toBe("0 credits")
		expect(formatPrice("openrouter", 0)).toBe("0 credits")
	})
})
