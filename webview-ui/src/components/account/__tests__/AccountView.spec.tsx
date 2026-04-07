import { render, screen, fireEvent } from "@testing-library/react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { AccountView } from "../AccountView"
import { useAppTranslation } from "@src/i18n/TranslationContext"

// Mock translation hook
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: vi.fn(() => ({
		t: (key: string) => key,
	})),
}))

// Mock VSCodeButton to prevent actual rendering issues
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({ children, onClick, appearance, className }: any) => (
		<button onClick={onClick} className={className} data-appearance={appearance}>
			{children}
		</button>
	),
}))

describe("AccountView", () => {
	const mockOnDone = vi.fn()
	const mockUserInfo = {
		email: "user@example.com",
		firstName: "John",
		lastName: "Doe",
		planType: "starter",
		credits: 20100,
		avatarUrl: "https://example.com/avatar.jpg",
	}

	const mockBasicUserInfo = {
		email: "user@example.com",
		name: "John Doe",
		picture: "https://example.com/avatar.jpg",
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should render authenticated user with full Supabase data (connected)", () => {
		render(<AccountView userInfo={mockUserInfo} isAuthenticated={true} onDone={mockOnDone} />)

		// Check title
		expect(screen.getByText("account:title")).toBeInTheDocument()

		// Check avatar image
		const avatarImg = screen.getByAltText("account:profilePicture")
		expect(avatarImg).toHaveAttribute("src", "https://example.com/avatar.jpg")

		// Check full name
		expect(screen.getByText("John Doe")).toBeInTheDocument()

		// Check email
		expect(screen.getByText("user@example.com")).toBeInTheDocument()

		// Check plan badge
		const planBadge = screen.getByText("Starter Plan")
		expect(planBadge).toHaveClass("bg-vscode-button-backgroundHover")

		// Check credits
		expect(screen.getByText("20,100 credits")).toBeInTheDocument()

		// Check buttons
		expect(screen.getByText("account:visitCloudWebsite")).toBeInTheDocument()
		expect(screen.getByText("account:logOut")).toBeInTheDocument()
	})

	it("should render authenticated user with basic Clerk data (not connected)", () => {
		render(<AccountView userInfo={mockBasicUserInfo} isAuthenticated={true} onDone={mockOnDone} />)

		// Check title
		expect(screen.getByText("account:title")).toBeInTheDocument()

		// Check avatar image
		const avatarImg = screen.getByAltText("account:profilePicture")
		expect(avatarImg).toHaveAttribute("src", "https://example.com/avatar.jpg")

		// Check name
		expect(screen.getByText("John Doe")).toBeInTheDocument()

		// Check email
		expect(screen.getByText("user@example.com")).toBeInTheDocument()

		// Should NOT show plan or credits
		expect(screen.queryByText("Plan")).not.toBeInTheDocument()
		expect(screen.queryByText("credits")).not.toBeInTheDocument()

		// Check buttons
		expect(screen.getByText("account:visitCloudWebsite")).toBeInTheDocument()
		expect(screen.getByText("account:logOut")).toBeInTheDocument()
	})

	it("should render unauthenticated state", () => {
		render(<AccountView userInfo={null} isAuthenticated={false} onDone={mockOnDone} />)

		// Check title
		expect(screen.getByText("account:title")).toBeInTheDocument()

		// Should show unauthenticated content
		expect(screen.getByText("account:cloudBenefitsTitle")).toBeInTheDocument()
		expect(screen.getByText("Create your account")).toBeInTheDocument()

		// Should NOT show authenticated content
		expect(screen.queryByText("user@example.com")).not.toBeInTheDocument()
		expect(screen.queryByText("Plan")).not.toBeInTheDocument()
	})

	it("should handle Done button click", () => {
		render(<AccountView userInfo={null} isAuthenticated={false} onDone={mockOnDone} />)

		const doneButton = screen.getByText("settings:common.done")
		fireEvent.click(doneButton)

		expect(mockOnDone).toHaveBeenCalledTimes(1)
	})

	it("should handle Connect button click", () => {
		const mockPostMessage = vi.fn()
		// Mock vscode.postMessage globally for this test
		;(global as any).vscode = { postMessage: mockPostMessage }

		render(<AccountView userInfo={null} isAuthenticated={false} onDone={mockOnDone} />)

		const connectButton = screen.getByText("Create your account")
		fireEvent.click(connectButton)

		expect(mockPostMessage).toHaveBeenCalledWith({ type: "rooCloudSignIn" })
	})

	it("should handle Visit Cloud Website button click", () => {
		const mockPostMessage = vi.fn()
		// Mock vscode.postMessage globally for this test
		;(global as any).vscode = { postMessage: mockPostMessage }

		render(<AccountView userInfo={mockUserInfo} isAuthenticated={true} onDone={mockOnDone} />)

		const visitButton = screen.getByText("account:visitCloudWebsite")
		fireEvent.click(visitButton)

		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "openExternal",
			url: expect.stringContaining("softcodes.ai"),
		})
	})

	it("should handle Logout button click", () => {
		const mockPostMessage = vi.fn()
		// Mock vscode.postMessage globally for this test
		;(global as any).vscode = { postMessage: mockPostMessage }

		render(<AccountView userInfo={mockUserInfo} isAuthenticated={true} onDone={mockOnDone} />)

		const logoutButton = screen.getByText("account:logOut")
		fireEvent.click(logoutButton)

		expect(mockPostMessage).toHaveBeenCalledWith({ type: "rooCloudSignOut" })
	})

	it("should show initials when no avatar is available", () => {
		const userWithoutAvatar = {
			...mockUserInfo,
			avatarUrl: undefined,
			picture: undefined,
		}

		render(<AccountView userInfo={userWithoutAvatar} isAuthenticated={true} onDone={mockOnDone} />)

		// Should show initials div instead of img
		const initialsDiv = screen.getByText("J") // First letter of John
		expect(initialsDiv).toHaveClass("flex items-center justify-center")
		expect(initialsDiv).not.toHaveAttribute("src")
	})

	it("should handle user with only first name", () => {
		const userWithFirstNameOnly = {
			...mockUserInfo,
			lastName: undefined,
		}

		render(<AccountView userInfo={userWithFirstNameOnly} isAuthenticated={true} onDone={mockOnDone} />)

		expect(screen.getByText("John")).toBeInTheDocument()
	})

	it("should handle user with only email (no name)", () => {
		const userWithEmailOnly = {
			email: "user@example.com",
			planType: "starter",
			credits: 5000,
		}

		render(<AccountView userInfo={userWithEmailOnly} isAuthenticated={true} onDone={mockOnDone} />)

		// Should show email but no name
		expect(screen.getByText("user@example.com")).toBeInTheDocument()
		expect(screen.queryByText(/John|Doe/)).not.toBeInTheDocument()

		// Should show plan and credits
		expect(screen.getByText("Starter Plan")).toBeInTheDocument()
		expect(screen.getByText("5,000 credits")).toBeInTheDocument()

		// Should show initials from email
		const initialsDiv = screen.getByText("U")
		expect(initialsDiv).toHaveClass("flex items-center justify-center")
	})
})
