import React from "react"
import { render, screen, waitFor } from "@testing-library/react"
import { vi } from "vitest"
import ProfileView from "../ProfileView"

// Mock hooks and utils
const mockUseExtensionState = vi.fn(() => ({
	apiConfiguration: { kilocodeToken: "mock-token" },
	currentApiConfigName: "default",
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: mockUseExtensionState,
}))

const mockUseAppTranslation = vi.fn(() => ({
	t: (key: string) => key,
}))

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: mockUseAppTranslation,
}))

vi.mock("@/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

// Mock useEffect to prevent real side effects
const mockUseEffect = vi.fn()
vi.mock("react", async () => {
	const actual = await vi.importActual("react")
	return {
		...actual,
		useEffect: mockUseEffect,
	}
})

// Mock window.addEventListener and dispatchEvent
Object.defineProperty(window, "addEventListener", {
	writable: true,
	value: vi.fn(),
})
Object.defineProperty(window, "removeEventListener", {
	writable: true,
	value: vi.fn(),
})
const mockDispatchEvent = vi.fn()
Object.defineProperty(window, "dispatchEvent", {
	writable: true,
	value: mockDispatchEvent,
})

describe("ProfileView Balance Display", () => {
	const mockOnDone = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
		mockDispatchEvent.mockClear()
	})

	it("displays balance in credits with 2 decimal formatting", async () => {
		const mockAuthState = {
			supabaseUserData: {
				credits: 100,
				plan_type: "pro",
			},
		}

		mockUseEffect.mockImplementation((fn) => {
			// Simulate message event after render
			queueMicrotask(() => {
				const event = new MessageEvent("message", {
					data: {
						type: "authStateChanged",
						isAuthenticated: true,
						isConnected: true,
						authenticationState: mockAuthState,
						softcodesUserInfo: { email: "test@example.com" },
					},
				})
				mockDispatchEvent(event)
				fn()
			})
		})

		render(<ProfileView onDone={mockOnDone} />)

		await waitFor(() => {
			expect(screen.getByText("100.00 credits")).toBeInTheDocument()
		})

		// Check plan display
		expect(screen.getByText("Pro Plan")).toBeInTheDocument()
	})

	it("displays balance with 2 decimals for fractional credits", async () => {
		const mockAuthState = {
			supabaseUserData: {
				credits: 71.4286, // ≈71.43 credits
				plan_type: "pro",
			},
		}

		mockUseEffect.mockImplementation((fn) => {
			queueMicrotask(() => {
				const event = new MessageEvent("message", {
					data: {
						type: "authStateChanged",
						isAuthenticated: true,
						isConnected: true,
						authenticationState: mockAuthState,
						softcodesUserInfo: { email: "test@example.com" },
					},
				})
				mockDispatchEvent(event)
				fn()
			})
		})

		render(<ProfileView onDone={mockOnDone} />)

		await waitFor(() => {
			expect(screen.getByText("71.43 credits")).toBeInTheDocument()
		})
	})

	it("does not display balance if credits are undefined", async () => {
		const mockAuthState = {
			supabaseUserData: {
				plan_type: "free",
				// No credits
			},
		}

		mockUseEffect.mockImplementation((fn) => {
			queueMicrotask(() => {
				const event = new MessageEvent("message", {
					data: {
						type: "authStateChanged",
						isAuthenticated: true,
						isConnected: true,
						authenticationState: mockAuthState,
						softcodesUserInfo: { email: "test@example.com" },
					},
				})
				mockDispatchEvent(event)
				fn()
			})
		})

		render(<ProfileView onDone={mockOnDone} />)

		await waitFor(() => {
			expect(screen.queryByText(/credits/)).not.toBeInTheDocument()
		})
	})

	it("handles zero credits by displaying 0.00 credits", async () => {
		const mockAuthState = {
			supabaseUserData: {
				credits: 0,
				plan_type: "free",
			},
		}

		mockUseEffect.mockImplementation((fn) => {
			queueMicrotask(() => {
				const event = new MessageEvent("message", {
					data: {
						type: "authStateChanged",
						isAuthenticated: true,
						isConnected: true,
						authenticationState: mockAuthState,
						softcodesUserInfo: { email: "test@example.com" },
					},
				})
				mockDispatchEvent(event)
				fn()
			})
		})

		render(<ProfileView onDone={mockOnDone} />)

		await waitFor(() => {
			expect(screen.getByText("0.00 credits")).toBeInTheDocument()
		})
	})
})
