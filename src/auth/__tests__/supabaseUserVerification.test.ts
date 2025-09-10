/**
 * Supabase User Verification Tests
 *
 * Simple tests to verify JWT user IDs against Supabase database
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { verifyJWTUserInSupabase, testUserIdInSupabase } from "../supabaseUserVerification"

// Mock Supabase
const mockSupabaseClient = {
	from: vi.fn(() => ({
		select: vi.fn(() => ({
			eq: vi.fn(() => ({
				single: vi.fn(),
			})),
		})),
	})),
}

const mockCreateClient = vi.fn(() => mockSupabaseClient)

vi.mock("@supabase/supabase-js", () => ({
	createClient: mockCreateClient,
}))

// Mock environment variables
const originalEnv = process.env

describe("Supabase User Verification", () => {
	beforeEach(() => {
		vi.clearAllMocks()

		// Set up environment variables
		process.env = {
			...originalEnv,
			NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
			SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
		}
	})

	afterEach(() => {
		process.env = originalEnv
	})

	it("should verify user exists in Supabase", async () => {
		// Mock JWT token with user ID
		const mockToken =
			"eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzMxdmR3N2M5QkFZQ0hHSElnZ2ZUYkp1VVJJUyIsImlzcyI6Imh0dHBzOi8vY2xlcmsuc29mdGNvZGVzLmFpIiwiZXhwIjoxNzU3NTA2MDc2fQ.signature"

		// Mock Supabase response - user found
		const mockUserData = {
			id: 123,
			clerk_id: "user_31vdw7c9BAYCHGHIggfTbJuURIS",
			email: "test@example.com",
			first_name: "John",
			last_name: "Doe",
			created_at: "2024-01-01T00:00:00Z",
			updated_at: "2024-01-01T00:00:00Z",
		}

		mockSupabaseClient.from().select().eq().single.mockResolvedValue({
			data: mockUserData,
			error: null,
		})

		const result = await verifyJWTUserInSupabase(mockToken)

		expect(result.success).toBe(true)
		expect(result.userIdExtracted).toBe("user_31vdw7c9BAYCHGHIggfTbJuURIS")
		expect(result.userExistsInSupabase).toBe(true)
		expect(result.userDetails).toEqual(mockUserData)

		// Verify the correct query was made
		expect(mockSupabaseClient.from).toHaveBeenCalledWith("users")
		expect(mockSupabaseClient.from().select).toHaveBeenCalledWith("*", { count: "exact" })
		expect(mockSupabaseClient.from().select().eq).toHaveBeenCalledWith(
			"clerk_id",
			"user_31vdw7c9BAYCHGHIggfTbJuURIS",
		)
	})

	it("should handle user not found in Supabase", async () => {
		const mockToken =
			"eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyX25vdGZvdW5kIiwiaXNzIjoiaHR0cHM6Ly9jbGVyay5zb2Z0Y29kZXMuYWkiLCJleHAiOjE3NTc1MDYwNzZ9.signature"

		// Mock Supabase response - user not found
		mockSupabaseClient
			.from()
			.select()
			.eq()
			.single.mockResolvedValue({
				data: null,
				error: { code: "PGRST116", message: "The result contains 0 rows" },
			})

		const result = await verifyJWTUserInSupabase(mockToken)

		expect(result.success).toBe(true)
		expect(result.userIdExtracted).toBe("user_notfound")
		expect(result.userExistsInSupabase).toBe(false)
		expect(result.error).toBe("User not found in Supabase database")
	})

	it("should handle invalid JWT tokens", async () => {
		const invalidToken = "invalid.jwt.token"

		const result = await verifyJWTUserInSupabase(invalidToken)

		expect(result.success).toBe(false)
		expect(result.error).toContain("Failed to parse JWT")
	})

	it("should handle missing Supabase configuration", async () => {
		// Remove environment variables
		delete process.env.NEXT_PUBLIC_SUPABASE_URL
		delete process.env.SUPABASE_SERVICE_ROLE_KEY
		delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

		const mockToken =
			"eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEyMyIsImlzcyI6Imh0dHBzOi8vY2xlcmsuc29mdGNvZGVzLmFpIiwiZXhwIjoxNzU3NTA2MDc2fQ.signature"

		const result = await verifyJWTUserInSupabase(mockToken)

		expect(result.success).toBe(false)
		expect(result.error).toContain("Supabase configuration missing")
	})

	it("should handle database errors", async () => {
		const mockToken =
			"eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEyMyIsImlzcyI6Imh0dHBzOi8vY2xlcmsuc29mdGNvZGVzLmFpIiwiZXhwIjoxNzU3NTA2MDc2fQ.signature"

		// Mock database error
		mockSupabaseClient
			.from()
			.select()
			.eq()
			.single.mockResolvedValue({
				data: null,
				error: { code: "CONNECTION_ERROR", message: "Unable to connect to database" },
			})

		const result = await verifyJWTUserInSupabase(mockToken)

		expect(result.success).toBe(false)
		expect(result.error).toContain("Database query failed")
	})
})

describe("Direct User ID Testing", () => {
	beforeEach(() => {
		vi.clearAllMocks()

		process.env = {
			...originalEnv,
			NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
			SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
		}
	})

	it("should test user ID directly in Supabase", async () => {
		const testUserId = "user_31vdw7c9BAYCHGHIggfTbJuURIS"

		const mockUserData = {
			id: 123,
			clerk_id: testUserId,
			email: "test@example.com",
			first_name: "John",
			last_name: "Doe",
		}

		mockSupabaseClient.from().select().eq().single.mockResolvedValue({
			data: mockUserData,
			error: null,
		})

		const result = await testUserIdInSupabase(testUserId)

		expect(result.success).toBe(true)
		expect(result.userExistsInSupabase).toBe(true)
		expect(result.userDetails).toEqual(mockUserData)
	})
})
