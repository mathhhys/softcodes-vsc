import { vscode } from "@/utils/vscode"

export const IdeaSuggestionsBox = () => {
	return (
		<div className="mt-4 p-3 bg-vscode-input-background rounded border border-vscode-panel-border">
			<p className="text-sm text-vscode-descriptionForeground">
				<button
					onClick={() => {
						vscode.postMessage({
							type: "insertTextToChatArea",
							text: "build a space invaders game",
						})
					}}
					className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground underline cursor-pointer bg-transparent border-none p-0 font-sans">
					Click here
				</button>
				{" for a cool idea, then tap on "}
				<span className="codicon codicon-send inline-block align-middle" />
				{" and watch me do magic!"}
			</p>
		</div>
	)
}
