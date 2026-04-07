/**
 * Credit Badge System
 *
 * Main entry point for the VSCode credit badge system that converts
 * monetary costs to credit units and displays them in the status bar.
 */

export { CreditConverter } from "./CreditConverter"
export { CreditAccumulator } from "./CreditAccumulator"
export { BadgeConfigurationManager } from "./BadgeConfiguration"
export { StatusBarBadge } from "./StatusBarBadge"
export { VisualFeedbackManager } from "./VisualFeedback"
export { CreditBadgeManager, creditBadgeManager } from "./CreditBadgeManager"

export type { ConversionConfig, ConversionResult, Operation, ConversionSummary } from "./CreditConverter"

export type { SessionOperation, SessionStats } from "./CreditAccumulator"

export type { BadgeConfiguration, ColorThreshold } from "./BadgeConfiguration"

export type { BadgeState } from "./StatusBarBadge"

export type { AnimationConfig, NotificationStyle } from "./VisualFeedback"
