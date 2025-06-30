import * as vscode from "vscode"
import { ClineProvider } from "../../webview/ClineProvider"
import { t } from "../../../i18n"
import { checkpointRestore } from "../../checkpoints"

// Helper function to delete messages for resending
export const deleteMessagesForResend = async (cline: any, originalMessageIndex: number, originalMessageTs: number) => {
	// Delete UI messages after the edited message
	const newClineMessages = cline.clineMessages.slice(0, originalMessageIndex)
	await cline.overwriteClineMessages(newClineMessages)

	// Delete API messages after the edited message
	const apiHistory = [...cline.apiConversationHistory]
	const timeCutoff = originalMessageTs - 1000
	const apiHistoryIndex = apiHistory.findIndex((entry) => entry.ts && entry.ts >= timeCutoff)

	if (apiHistoryIndex !== -1) {
		const newApiHistory = apiHistory.slice(0, apiHistoryIndex)
		await cline.overwriteApiConversationHistory(newApiHistory)
	}
}

// Helper function to handle the checkpoint restoration and message resending
export const handleCheckpointAndResend = async (
	provider: ClineProvider,
	taskId: string,
	timestamp: number,
	checkpointHash: string,
	newText: string,
): Promise<boolean> => {
	try {
		// Get the history item for the task
		const { historyItem } = await provider.getTaskWithId(taskId)
		if (!historyItem) {
			return false
		}

		// Initialize a new Cline instance with the history
		const newCline = await provider.initClineWithHistoryItem(historyItem)
		if (!newCline) {
			return false
		}

		// Use the imported checkpointRestore function which already handles waiting for initialization
		try {
			await checkpointRestore(newCline, {
				ts: timestamp,
				commitHash: checkpointHash,
				mode: "restore",
			})
		} catch (error) {
			provider.log(`[Edit Message] Error during checkpoint restoration for task ${taskId}: ${error.message}`)
			return false
		}

		return true
	} catch (error) {
		console.error("Error during checkpoint restoration and resend:", error)
		return false
	}
}

// Helper function to encapsulate the common sequence of actions for resending a message
export const resendMessageSequence = async (
	provider: ClineProvider,
	taskId: string,
	originalMessageIndex: number,
	originalMessageTimestamp: number,
	editedText: string,
	images?: any,
): Promise<boolean> => {
	// 1. Get the current cline instance before deletion
	const currentCline = provider.getCurrentCline()
	if (!currentCline || currentCline.taskId !== taskId) {
		provider.log(`[Edit Message] Error: Could not get current cline instance before deletion for task ${taskId}.`)
		vscode.window.showErrorMessage(t("common:errors.message_update_failed"))
		return false
	}

	// 2. Delete messages using the helper
	await deleteMessagesForResend(currentCline, originalMessageIndex, originalMessageTimestamp)

	// 3. Re-initialize Cline with the history item (which now reflects the deleted messages)
	const { historyItem } = await provider.getTaskWithId(taskId)
	if (!historyItem) {
		provider.log(`[Edit Message] Error: Failed to retrieve history item for task ${taskId}.`)
		vscode.window.showErrorMessage(t("common:errors.message_update_failed"))
		return false
	}

	const newCline = await provider.initClineWithHistoryItem(historyItem)
	if (!newCline) {
		provider.log(
			`[Edit Message] Error: Failed to re-initialize Cline with updated history item for task ${taskId}.`,
		)
		vscode.window.showErrorMessage(t("common:errors.message_update_failed"))
		return false
	}

	// 4. Send the edited message using the newly initialized Cline instance
	await new Promise((resolve) => setTimeout(resolve, 100)) // Add delay to mitigate race condition
	await newCline.handleWebviewAskResponse("messageResponse", editedText, images)

	return true
}
