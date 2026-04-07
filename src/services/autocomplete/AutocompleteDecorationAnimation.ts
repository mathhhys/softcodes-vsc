import * as vscode from "vscode"

export const UI_SHOW_LOADING_DELAY_MS = 150

/**
 * Manages the animated decoration for autocomplete loading indicator
 */
export class AutocompleteDecorationAnimation {
	private static instance: AutocompleteDecorationAnimation
	private animationInitialWaitTimer: NodeJS.Timeout | null = null
	private animationInterval: NodeJS.Timeout | null = null
	private decorationType: vscode.TextEditorDecorationType
	private animationState = 0
	private readonly loadingFrames = ["|", "|", "|", "|"]
	private editor: vscode.TextEditor | null = null
	private range: vscode.Range | null = null

	private constructor() {
		this.decorationType = vscode.window.createTextEditorDecorationType({
			after: {
				color: new vscode.ThemeColor("editorGhostText.foreground"),
				fontStyle: "italic",
				contentText: "|", // Initial state before animation starts
			},
			rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
		})
	}

	public static getInstance(): AutocompleteDecorationAnimation {
		if (!AutocompleteDecorationAnimation.instance) {
			AutocompleteDecorationAnimation.instance = new AutocompleteDecorationAnimation()
		}
		return AutocompleteDecorationAnimation.instance
	}

	/**
	 * Starts the loading animation at the specified range in the editor
	 */
	public startAnimation(): void {
		const editor = vscode.window.activeTextEditor
		if (!editor) return

		this.stopAnimation() // Stop any existing animation

		const position = editor.selection.active
		const document = editor.document
		const lineEndPosition = new vscode.Position(position.line, document.lineAt(position.line).text.length)

		this.editor = editor
		this.range = new vscode.Range(lineEndPosition, lineEndPosition)
		this.animationState = 0

		// Delay starting the animation slightly to not distract users
		// We're still fetching the completion, this just delays showing the decorator.
		this.animationInitialWaitTimer = setTimeout(() => {
			// Apply initial animation state
			this.updateDecorationText()

			// Start animation interval
			this.animationInterval = setInterval(() => {
				this.updateAnimation()
			}, 300)
		}, UI_SHOW_LOADING_DELAY_MS)
	}

	/**
	 * Stops the loading animation and immediately hides the decorator
	 */
	public stopAnimation(): void {
		// Clear animation immediately
		if (this.animationInterval) {
			clearInterval(this.animationInterval)
			this.animationInterval = null
		}

		if (this.animationInitialWaitTimer) {
			clearTimeout(this.animationInitialWaitTimer)
		}

		if (this.editor && this.decorationType) {
			this.editor.setDecorations(this.decorationType, [])
		}

		this.editor = null
		this.range = null
	}

	/**
	 * Updates the animation state and decoration text
	 */
	private updateAnimation(): void {
		if (!this.editor || !this.range) {
			this.stopAnimation()
			return
		}

		this.animationState = (this.animationState + 1) % this.loadingFrames.length

		this.updateDecorationText()
	}

	/**
	 * Updates the decoration text based on current animation state
	 */
	private updateDecorationText(): void {
		if (!this.editor || !this.range) return

		const text = this.loadingFrames[this.animationState]

		// Update decoration type with new text
		const updatedDecorationType = vscode.window.createTextEditorDecorationType({
			after: {
				color: new vscode.ThemeColor("editorGhostText.foreground"),
				fontStyle: "italic",
				contentText: text,
			},
			rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
		})

		// Apply updated decoration
		this.editor.setDecorations(this.decorationType, [])
		this.decorationType = updatedDecorationType
		this.editor.setDecorations(this.decorationType, [this.range])
	}

	/**
	 * Disposes the decoration type and stops any active animation
	 */
	public dispose(): void {
		this.stopAnimation()
		this.decorationType?.dispose()
	}
}
