import { describe, test, expect, beforeEach } from "vitest"
import { CreditConverter, ConversionConfig } from "../CreditConverter"

describe("CreditConverter", () => {
	let converter: CreditConverter
	let defaultConfig: ConversionConfig

	beforeEach(() => {
		defaultConfig = {
			dollarToCreditRate: 0.014,
			roundingMode: "ceil",
			precision: 4,
		}
		converter = new CreditConverter(defaultConfig)
	})

	describe("convertUSDToCredits", () => {
		test("should convert USD to credits with ceiling rounding", () => {
			const result = converter.convertUSDToCredits(0.014)

			expect(result.originalUSD).toBe(0.014)
			expect(result.calculatedCredits).toBe(1)
			expect(result.roundedCredits).toBe(1)
			expect(result.efficiency).toBeCloseTo(71.43, 2)
		})

		test("should handle fractional credits with ceiling rounding", () => {
			const result = converter.convertUSDToCredits(0.02)

			expect(result.calculatedCredits).toBeCloseTo(1.4286, 4)
			expect(result.roundedCredits).toBe(2) // ceil(1.4286) = 2
		})

		test("should use floor rounding when configured", () => {
			converter.updateConfig({ roundingMode: "floor" })
			const result = converter.convertUSDToCredits(0.02)

			expect(result.roundedCredits).toBe(1) // floor(1.4286) = 1
		})

		test("should use round rounding when configured", () => {
			converter.updateConfig({ roundingMode: "round" })
			const result = converter.convertUSDToCredits(0.02)

			expect(result.roundedCredits).toBe(1) // round(1.4286) = 1
		})

		test("should use precise rounding when configured", () => {
			converter.updateConfig({ roundingMode: "precise" })
			const result = converter.convertUSDToCredits(0.02)

			// 0.020 / 0.014 = 1.42857...
			// precise mode should use toFixed(2) -> 1.43
			expect(result.roundedCredits).toBe(1.43)
		})

		test("should handle zero cost", () => {
			const result = converter.convertUSDToCredits(0)

			expect(result.originalUSD).toBe(0)
			expect(result.calculatedCredits).toBe(0)
			expect(result.roundedCredits).toBe(0)
		})

		test("should handle large amounts", () => {
			const result = converter.convertUSDToCredits(1.4) // $1.40

			expect(result.calculatedCredits).toBe(100)
			expect(result.roundedCredits).toBe(100)
		})
	})

	describe("convertOperationsToCredits", () => {
		test("should properly accumulate fractional credits", () => {
			const operations = [
				{ usd: 0.014, description: "Operation 1" },
				{ usd: 0.014, description: "Operation 2" },
				{ usd: 0.014, description: "Operation 3" },
			]

			const result = converter.convertOperationsToCredits(operations)

			expect(result.totalUSD).toBe(0.042)
			expect(result.totalCredits).toBe(3) // ceil(0.042 / 0.014) = 3
			expect(result.operationBreakdown).toHaveLength(3)
			expect(result.operationBreakdown[0].credits).toBe(1)
		})

		test("should handle mixed operation costs", () => {
			const operations = [
				{ usd: 0.07, description: "Code Generation" },
				{ usd: 0.014, description: "Simple Query" },
				{ usd: 0.042, description: "Code Analysis" },
			]

			const result = converter.convertOperationsToCredits(operations)

			expect(result.totalUSD).toBe(0.126)
			expect(result.totalCredits).toBe(9) // ceil(0.126 / 0.014) = 9
			expect(result.operationBreakdown).toHaveLength(3)
			expect(result.operationBreakdown[0].credits).toBe(5) // Code Generation
			expect(result.operationBreakdown[1].credits).toBe(1) // Simple Query
			expect(result.operationBreakdown[2].credits).toBe(3) // Code Analysis
		})

		test("should handle empty operations array", () => {
			const result = converter.convertOperationsToCredits([])

			expect(result.totalUSD).toBe(0)
			expect(result.totalCredits).toBe(0)
			expect(result.operationBreakdown).toHaveLength(0)
		})
	})

	describe("convertCreditsToUSD", () => {
		test("should convert credits back to USD", () => {
			const usd = converter.convertCreditsToUSD(10)
			expect(usd).toBe(0.14)
		})

		test("should handle zero credits", () => {
			const usd = converter.convertCreditsToUSD(0)
			expect(usd).toBe(0)
		})

		test("should handle fractional credits", () => {
			const usd = converter.convertCreditsToUSD(1.5)
			expect(usd).toBeCloseTo(0.021, 3)
		})
	})

	describe("updateConfig", () => {
		test("should update conversion rate", () => {
			converter.updateConfig({ dollarToCreditRate: 0.01 })

			const result = converter.convertUSDToCredits(0.01)
			expect(result.roundedCredits).toBe(1)
		})

		test("should update rounding mode", () => {
			converter.updateConfig({ roundingMode: "floor" })

			const result = converter.convertUSDToCredits(0.02)
			expect(result.roundedCredits).toBe(1) // floor instead of ceil
		})

		test("should update precision", () => {
			converter.updateConfig({ precision: 2 })

			const result = converter.convertUSDToCredits(0.02)
			expect(result.calculatedCredits).toBe(1.43) // rounded to 2 decimal places
		})
	})

	describe("getConfig", () => {
		test("should return current configuration", () => {
			const config = converter.getConfig()

			expect(config.dollarToCreditRate).toBe(0.014)
			expect(config.roundingMode).toBe("ceil")
			expect(config.precision).toBe(4)
		})

		test("should return copy of configuration", () => {
			const config = converter.getConfig()
			config.dollarToCreditRate = 0.01

			// Original converter config should be unchanged
			expect(converter.getConfig().dollarToCreditRate).toBe(0.014)
		})
	})

	describe("edge cases", () => {
		test("should handle very small amounts", () => {
			const result = converter.convertUSDToCredits(0.001)

			expect(result.calculatedCredits).toBeCloseTo(0.0714, 4)
			expect(result.roundedCredits).toBe(1) // ceil
		})

		test("should handle negative amounts", () => {
			const result = converter.convertUSDToCredits(-0.014)

			expect(result.originalUSD).toBe(-0.014)
			expect(result.calculatedCredits).toBe(-1)
			expect(result.roundedCredits).toBe(-1)
		})

		test("should handle different rounding modes with the same input", () => {
			const testAmount = 0.025 // Should be ~1.786 credits

			// Test ceil
			converter.updateConfig({ roundingMode: "ceil" })
			expect(converter.convertUSDToCredits(testAmount).roundedCredits).toBe(2)

			// Test floor
			converter.updateConfig({ roundingMode: "floor" })
			expect(converter.convertUSDToCredits(testAmount).roundedCredits).toBe(1)

			// Test round
			converter.updateConfig({ roundingMode: "round" })
			expect(converter.convertUSDToCredits(testAmount).roundedCredits).toBe(2)

			// Test precise
			converter.updateConfig({ roundingMode: "precise" })
			// 0.025 / 0.014 = 1.7857... -> 1.79
			expect(converter.convertUSDToCredits(testAmount).roundedCredits).toBe(1.79)
		})
	})
})
