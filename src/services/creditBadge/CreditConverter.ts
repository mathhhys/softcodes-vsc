/**
 * Credit Converter Service
 *
 * Handles USD-to-credit conversion with configurable rates and rounding logic.
 * Properly handles fractional credits with accumulation.
 */

import Decimal from "decimal.js"

export interface ConversionConfig {
	dollarToCreditRate: number // Default: 0.014
	roundingMode: "ceil" | "floor" | "round" | "precise"
	precision: number // Decimal places for intermediate calculations
}

export interface ConversionResult {
	originalUSD: number
	calculatedCredits: number
	roundedCredits: number
	efficiency: number // Credits per dollar
}

export interface Operation {
	usd: number
	description: string
}

export interface ConversionSummary {
	totalCredits: number
	totalUSD: number
	operationBreakdown: Array<{
		description: string
		usd: number
		credits: number
	}>
}

export class CreditConverter {
	private config: ConversionConfig

	constructor(config: ConversionConfig) {
		this.config = config
	}

	convertUSDToCredits(usdAmount: number): ConversionResult {
		const rate = new Decimal(this.config.dollarToCreditRate)
		const usd = new Decimal(usdAmount)
		const calculatedCredits = usd.div(rate)
		const roundedCredits = this.applyRounding(+calculatedCredits)

		return {
			originalUSD: usdAmount,
			calculatedCredits: +calculatedCredits.toFixed(this.config.precision),
			roundedCredits,
			efficiency: roundedCredits / usdAmount,
		}
	}

	convertCreditsToUSD(credits: number): number {
		const credit = new Decimal(credits)
		const rate = new Decimal(this.config.dollarToCreditRate)
		return +credit.mul(rate)
	}

	private applyRounding(value: number): number {
		switch (this.config.roundingMode) {
			case "ceil":
				return Math.ceil(value)
			case "floor":
				return Math.floor(value)
			case "round":
				return Math.round(value)
			case "precise":
				return Number(value.toFixed(2))
			default:
				return Number(value.toFixed(2))
		}
	}

	// Handle multiple operations with proper fractional credit accumulation
	convertOperationsToCredits(operations: Operation[]): ConversionSummary {
		const totalUSD = operations.reduce((sum, op) => sum + op.usd, 0)
		const totalCredits = this.convertUSDToCredits(totalUSD).roundedCredits

		const operationBreakdown = operations.map((op) => ({
			description: op.description,
			usd: op.usd,
			credits: this.convertUSDToCredits(op.usd).roundedCredits,
		}))

		return {
			totalCredits,
			totalUSD,
			operationBreakdown,
		}
	}

	updateConfig(newConfig: Partial<ConversionConfig>): void {
		this.config = { ...this.config, ...newConfig }
	}

	getConfig(): ConversionConfig {
		return { ...this.config }
	}
}
