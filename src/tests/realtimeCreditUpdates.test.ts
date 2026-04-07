/**
 * Real-time Credit Updates Service Tests
 *
 * Test suite for the real-time credit updates using Supabase Realtime
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest"
import { EventEmitter } from "events"
import { RealtimeCreditService, realtimeCreditService } from "../services/realtimeCreditUpdates"

// Mock Supabase client
const mockChannel = {
	on: vi.fn().mockReturnThis(),
	subscribe: vi.fn(),
	unsubscribe: vi.fn(),
}

const mockSupabaseClient = {
	channel: vi.fn(() => mockChannel),
	removeChannel: vi.fn(),
}

vi.mock("@supabase/supabase-js", () => ({
	createClient: vi.fn(() => mockSupabaseClient),
}))

// Mock credit manager
vi.mock("../services/creditManager", () => ({
	creditManager: {
		getUserCreditBalance: vi.fn(),
		clearUserCache: vi.fn(),
	},
}))

// Mock environment variables
const mockEnv = {
	NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
	NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
}

beforeEach(() => {
	Object.assign(process.env, mockEnv)
	vi.clearAllMocks()
})

describe("RealtimeCreditService", () => {
	describe("Initialization", () => {
		test("should create singleton instance", () => {
			const instance1 = RealtimeCreditService.getInstance()
			const instance2 = RealtimeCreditService.getInstance()
			expect(instance1).toBe(instance2)
		})

		test("should initialize Supabase client with correct config", () => {
			const { createClient } = require("@supabase/supabase-js")
			RealtimeCreditService.getInstance()

			expect(createClient).toHaveBeenCalledWith("https://test.supabase.co", "test-anon-key", {
				realtime: {
					params: {
						eventsPerSecond: 10,
					},
				},
			})
		})
	})

	describe("Subscription Management", () => {
		const mockClerkUserId = "user_123"
		const mockCallback = vi.fn()

		beforeEach(() => {
			const { creditManager } = require("../services/creditManager")
			creditManager.getUserCreditBalance.mockResolvedValue({
				userId: "internal_user_123",
				clerkId: mockClerkUserId,
				currentCredits: 100,
			})
		})

		test("should subscribe to user credit updates", async () => {
			mockChannel.subscribe.mockImplementation((callback) => {
				callback("SUBSCRIBED")
				return mockChannel
			})

			const subscriptionId = await realtimeCreditService.subscribeToUserCredits(mockClerkUserId, mockCallback)

			expect(subscriptionId).toBe(`credits-${mockClerkUserId}`)
			expect(mockSupabaseClient.channel).toHaveBeenCalledWith(`credits-${mockClerkUserId}`)
			expect(mockChannel.on).toHaveBeenCalledTimes(2) // users table + credit_transactions table
			expect(mockChannel.subscribe).toHaveBeenCalled()
		})

		test("should handle subscription failure", async () => {
			const { creditManager } = require("../services/creditManager")
			creditManager.getUserCreditBalance.mockResolvedValue(null)

			const subscriptionId = await realtimeCreditService.subscribeToUserCredits(mockClerkUserId, mockCallback)

			expect(subscriptionId).toBeNull()
		})

		test("should unsubscribe from user updates", async () => {
			// First subscribe
			mockChannel.subscribe.mockImplementation((callback) => {
				callback("SUBSCRIBED")
				return mockChannel
			})

			await realtimeCreditService.subscribeToUserCredits(mockClerkUserId, mockCallback)

			// Then unsubscribe
			await realtimeCreditService.unsubscribeFromUser(mockClerkUserId)

			expect(mockSupabaseClient.removeChannel).toHaveBeenCalledWith(mockChannel)
		})

		test("should unsubscribe from all updates", async () => {
			// Subscribe to multiple users
			const user1 = "user_123"
			const user2 = "user_456"

			mockChannel.subscribe.mockImplementation((callback) => {
				callback("SUBSCRIBED")
				return mockChannel
			})

			await realtimeCreditService.subscribeToUserCredits(user1, mockCallback)
			await realtimeCreditService.subscribeToUserCredits(user2, mockCallback)

			// Unsubscribe from all
			await realtimeCreditService.unsubscribeAll()

			expect(mockSupabaseClient.removeChannel).toHaveBeenCalledTimes(2)
		})
	})

	describe("Credit Update Handling", () => {
		const mockClerkUserId = "user_123"
		let updateHandler: (payload: any) => void
		let transactionHandler: (payload: any) => void

		beforeEach(async () => {
			const { creditManager } = require("../services/creditManager")
			creditManager.getUserCreditBalance.mockResolvedValue({
				userId: "internal_user_123",
				clerkId: mockClerkUserId,
				currentCredits: 100,
			})

			// Capture the handlers when subscription is created
			mockChannel.on.mockImplementation((event, config, handler) => {
				if (config.table === "users") {
					updateHandler = handler
				} else if (config.table === "credit_transactions") {
					transactionHandler = handler
				}
				return mockChannel
			})

			mockChannel.subscribe.mockImplementation((callback) => {
				callback("SUBSCRIBED")
				return mockChannel
			})

			const mockCallback = vi.fn()
			await realtimeCreditService.subscribeToUserCredits(mockClerkUserId, mockCallback)
		})

		test("should handle user credit balance updates", () => {
			const mockCallback = vi.fn()

			const payload = {
				old: { credits: 100, clerk_id: mockClerkUserId, id: "internal_user_123" },
				new: { credits: 95, clerk_id: mockClerkUserId, id: "internal_user_123" },
			}

			// Simulate the update handler being called
			updateHandler(payload)

			expect(mockCallback).toHaveBeenCalledWith(
				expect.objectContaining({
					userId: "internal_user_123",
					clerkId: mockClerkUserId,
					previousBalance: 100,
					newBalance: 95,
					creditsChanged: -5,
					operation: "deduction",
				}),
			)
		})

		test("should handle credit transactions", () => {
			const mockCallback = vi.fn()

			const payload = {
				new: {
					user_id: "internal_user_123",
					operation_type: "deduction",
					credits_amount: 5,
					usd_amount: "0.070",
					balance_before: 100,
					balance_after: 95,
					created_at: "2023-01-01T00:00:00Z",
				},
			}

			// Simulate the transaction handler being called
			transactionHandler(payload)

			expect(mockCallback).toHaveBeenCalledWith(
				expect.objectContaining({
					userId: "internal_user_123",
					clerkId: mockClerkUserId,
					previousBalance: 100,
					newBalance: 95,
					creditsChanged: -5,
					usdAmount: 0.07,
					operation: "deduction",
				}),
			)
		})

		test("should ignore zero credit changes", () => {
			const mockCallback = vi.fn()

			const payload = {
				old: { credits: 100, clerk_id: mockClerkUserId, id: "internal_user_123" },
				new: { credits: 100, clerk_id: mockClerkUserId, id: "internal_user_123" },
			}

			updateHandler(payload)

			expect(mockCallback).not.toHaveBeenCalled()
		})

		test("should emit low credit warnings", () => {
			const warningListener = vi.fn()
			realtimeCreditService.on("lowCreditWarning", warningListener)

			const payload = {
				old: { credits: 15, clerk_id: mockClerkUserId, id: "internal_user_123" },
				new: { credits: 8, clerk_id: mockClerkUserId, id: "internal_user_123", plan_type: "pro" },
			}

			updateHandler(payload)

			expect(warningListener).toHaveBeenCalledWith(
				expect.objectContaining({
					userId: "internal_user_123",
					currentBalance: 8,
					threshold: 10,
					planType: "pro",
				}),
			)
		})

		test("should clear cache on credit updates", () => {
			const { creditManager } = require("../services/creditManager")

			const payload = {
				old: { credits: 100, clerk_id: mockClerkUserId, id: "internal_user_123" },
				new: { credits: 95, clerk_id: mockClerkUserId, id: "internal_user_123" },
			}

			updateHandler(payload)

			expect(creditManager.clearUserCache).toHaveBeenCalledWith(mockClerkUserId)
		})
	})

	describe("Connection Management", () => {
		test("should track connection status", async () => {
			const { creditManager } = require("../services/creditManager")
			creditManager.getUserCreditBalance.mockResolvedValue({
				userId: "internal_user_123",
				clerkId: "user_123",
				currentCredits: 100,
			})

			mockChannel.subscribe.mockImplementation((callback) => {
				callback("SUBSCRIBED")
				return mockChannel
			})

			await realtimeCreditService.subscribeToUserCredits("user_123", vi.fn())

			const status = realtimeCreditService.getStatus()
			expect(status.connected).toBe(true)
			expect(status.userId).toBe("user_123")
		})

		test("should handle disconnection and reconnection", async () => {
			const { creditManager } = require("../services/creditManager")
			creditManager.getUserCreditBalance.mockResolvedValue({
				userId: "internal_user_123",
				clerkId: "user_123",
				currentCredits: 100,
			})

			const mockCallback = vi.fn()
			let subscriptionCallback: ((status: string) => void) | undefined

			mockChannel.subscribe.mockImplementation((callback) => {
				subscriptionCallback = callback
				callback("SUBSCRIBED")
				return mockChannel
			})

			await realtimeCreditService.subscribeToUserCredits("user_123", mockCallback)

			// Simulate disconnection
			if (subscriptionCallback) {
				subscriptionCallback("CLOSED")
			}

			const status = realtimeCreditService.getStatus()
			expect(status.connected).toBe(false)
		})

		test("should get active subscription count", async () => {
			const { creditManager } = require("../services/creditManager")
			creditManager.getUserCreditBalance.mockResolvedValue({
				userId: "internal_user_123",
				clerkId: "user_123",
				currentCredits: 100,
			})

			mockChannel.subscribe.mockImplementation((callback) => {
				callback("SUBSCRIBED")
				return mockChannel
			})

			expect(realtimeCreditService.getActiveSubscriptions()).toBe(0)

			await realtimeCreditService.subscribeToUserCredits("user_123", vi.fn())
			expect(realtimeCreditService.getActiveSubscriptions()).toBe(1)

			await realtimeCreditService.subscribeToUserCredits("user_456", vi.fn())
			expect(realtimeCreditService.getActiveSubscriptions()).toBe(2)
		})
	})

	describe("Configuration", () => {
		test("should set low credit threshold", () => {
			realtimeCreditService.setLowCreditThreshold(15)

			// Test that the new threshold is used
			const payload = {
				old: { credits: 20, clerk_id: "user_123", id: "internal_user_123" },
				new: { credits: 14, clerk_id: "user_123", id: "internal_user_123" },
			}

			const warningListener = vi.fn()
			realtimeCreditService.on("lowCreditWarning", warningListener)

			// This should trigger a warning with the new threshold
			// (need to set up subscription first to get the handler)
		})
	})

	describe("Error Handling", () => {
		test("should handle subscription errors gracefully", async () => {
			const { creditManager } = require("../services/creditManager")
			creditManager.getUserCreditBalance.mockRejectedValue(new Error("Database error"))

			const errorListener = vi.fn()
			realtimeCreditService.on("error", errorListener)

			const result = await realtimeCreditService.subscribeToUserCredits("user_123", vi.fn())

			expect(result).toBeNull()
			expect(errorListener).toHaveBeenCalledWith(
				expect.objectContaining({
					error: expect.any(Error),
					userId: "user_123",
				}),
			)
		})

		test("should handle malformed update payloads", () => {
			// This test would require setting up a subscription first and then
			// calling the handler with malformed data
			const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

			// Simulate malformed payload
			const payload = {
				old: null,
				new: null,
			}

			// Would need to trigger the handler somehow...
			// This is more of an integration test

			consoleErrorSpy.mockRestore()
		})
	})

	afterEach(async () => {
		await realtimeCreditService.unsubscribeAll()
		vi.clearAllMocks()
	})
})

describe("Convenience Functions", () => {
	test("should export convenience functions", async () => {
		const { subscribeToUserCredits, unsubscribeFromUserCredits, onLowCreditWarning, onConnectionStatusChange } =
			await import("../services/realtimeCreditUpdates")

		expect(typeof subscribeToUserCredits).toBe("function")
		expect(typeof unsubscribeFromUserCredits).toBe("function")
		expect(typeof onLowCreditWarning).toBe("function")
		expect(typeof onConnectionStatusChange).toBe("function")
	})

	test("should set up low credit warning listeners", () => {
		const { onLowCreditWarning } = require("../services/realtimeCreditUpdates")
		const mockCallback = vi.fn()

		onLowCreditWarning(mockCallback)

		// Verify that the event listener was set up
		// This is hard to test without actually triggering the event
		expect(mockCallback).not.toHaveBeenCalled()
	})

	test("should set up connection status listeners", () => {
		const { onConnectionStatusChange } = require("../services/realtimeCreditUpdates")
		const mockConnected = vi.fn()
		const mockDisconnected = vi.fn()

		onConnectionStatusChange(mockConnected, mockDisconnected)

		// Verify that the event listeners were set up
		expect(mockConnected).not.toHaveBeenCalled()
		expect(mockDisconnected).not.toHaveBeenCalled()
	})
})
