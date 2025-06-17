import { cn } from "@/lib/utils"
import type { Decorator } from "@storybook/react"
import isChromatic from "chromatic/isChromatic"
import { PropsWithChildren, ReactNode } from "react"

// Decorator that renders both the light and dark theme of children for Chromatic screenshot testing
export const withChromaticDecorator: Decorator = (Story) => {
	return (
		<ChromaticDecorator>
			<Story />
		</ChromaticDecorator>
	)
}

const baseStyles = cn("flex flex-col items-stretch justify-stretch")
const chromaticStyles = cn("absolute size-full top-0 left-0 right-0 bottom-0", "bg-transparent-checkerboard")

/**
 * When rendering screenshots in Chromatic, we capture both the light/dark mode themed Stories at the same time.
 * Story components are rendered on the page twice- each wrapped in their own StorybookThemeProvider.
 */
function ChromaticDecorator({ children }: PropsWithChildren) {
	const styles = cn(baseStyles, isChromatic() && chromaticStyles)
	return (
		<div className={styles}>
			{isChromatic() ? (
				<div className="flex w-full">
					<ThemeModeContainer theme="dark">{children}</ThemeModeContainer>
					<ThemeModeContainer theme="light">{children}</ThemeModeContainer>
				</div>
			) : (
				children
			)}
		</div>
	)
}

function ThemeModeContainer({ children, theme }: { children: ReactNode; theme: string }) {
	return (
		<div data-theme={theme} className="w-full flex relative">
			<div className="bg-[var(--vscode-editor-background)] p-12">
				<div className="text-[12px] font-bold bg-lime-300 absolute top-0 left-0 p-1">{theme}</div>

				{children}
			</div>
		</div>
	)
}
