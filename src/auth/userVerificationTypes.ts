/**
 * User Verification Types for Clerk Backend Integration
 *
 * Comprehensive type definitions for backend user verification system
 */

/**
 * Result of user verification from Clerk backend
 */
export interface UserVerificationResult {
	valid: boolean
	user?: VerifiedUser
	error?: UserVerificationError
	fallbackMode?: boolean
	fallbackReason?: string
	cacheHit?: boolean
	responseTime?: number
}

/**
 * Verified user data from Clerk
 */
export interface VerifiedUser {
	id: string
	email?: string
	firstName?: string | null
	lastName?: string | null
	username?: string | null
	imageUrl?: string
	createdAt?: number
	updatedAt?: number
	lastActiveAt?: number
	banned?: boolean
	locked?: boolean
	verified?: boolean
	organizations?: Array<{
		id: string
		name: string
		role: string
	}>
}

/**
 * User verification error types and details
 */
export interface UserVerificationError {
	type: UserVerificationErrorType
	message: string
	userId?: string
	details?: string
	retryAfter?: number
	originalError?: Error
}

/**
 * Enumeration of user verification error types
 */
export enum UserVerificationErrorType {
	USER_NOT_FOUND = "USER_NOT_FOUND",
	USER_BANNED = "USER_BANNED",
	USER_LOCKED = "USER_LOCKED",
	USER_DELETED = "USER_DELETED",
	RATE_LIMITED = "RATE_LIMITED",
	API_UNAVAILABLE = "API_UNAVAILABLE",
	VERIFICATION_FAILED = "VERIFICATION_FAILED",
	NETWORK_ERROR = "NETWORK_ERROR",
	INVALID_USER_ID = "INVALID_USER_ID",
	UNAUTHORIZED = "UNAUTHORIZED",
}

/**
 * Cache entry for user verification results
 */
export interface CacheEntry {
	data: UserVerificationResult
	expiresAt: number
	createdAt: number
}

/**
 * Cache configuration options
 */
export interface CacheConfig {
	ttl: number // Time to live in seconds for positive results
	negativeTtl: number // Time to live for negative results
	maxSize: number // Maximum cache entries
	negativeCache: boolean // Whether to cache negative results
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
	size: number
	maxSize: number
	hits: number
	misses: number
	hitRate: number
	memoryUsage: number
	entries: Array<{ key: string; expiresIn: number }>
}

/**
 * Metrics for user verification monitoring
 */
export interface VerificationMetrics {
	totalVerifications: number
	successfulVerifications: number
	failedVerifications: number
	averageResponseTime: number
	cacheHitRate: number
	errorsByType: Record<UserVerificationErrorType, number>
	recentErrors: Array<{
		timestamp: Date
		userId: string
		error: string
		type: UserVerificationErrorType
	}>
}

/**
 * Request format for user verification API
 */
export interface VerificationRequest {
	userId: string
	includeOrganizations?: boolean
	bypassCache?: boolean
}

/**
 * Bulk verification request format
 */
export interface BulkVerificationRequest {
	userIds: string[]
	includeOrganizations?: boolean
	bypassCache?: boolean
}

/**
 * API response format for verification requests
 */
export interface VerificationResponse {
	success: boolean
	result?: UserVerificationResult
	results?: Record<string, UserVerificationResult>
	error?: string
	requestId: string
	timestamp: string
	cacheHit?: boolean
}

/**
 * Configuration for Clerk backend service
 */
export interface ClerkBackendConfig {
	secretKey: string
	apiUrl?: string
	apiVersion?: string
	timeout?: number
	retryAttempts?: number
}

/**
 * Options for user verification
 */
export interface VerificationOptions {
	includeOrganizations?: boolean
	bypassCache?: boolean
	timeout?: number
}

/**
 * Fallback strategy interface
 */
export interface FallbackStrategy {
	shouldActivate(error: Error): boolean
	verifyUser(userId: string): Promise<UserVerificationResult>
	getDescription(): string
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
	failureThreshold: number
	timeout: number
	resetTimeout: number
}

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
	windowMs: number
	max: number
	skipSuccessfulRequests?: boolean
	skipFailedRequests?: boolean
}

/**
 * Security middleware configuration
 */
export interface SecurityConfig {
	rateLimit: RateLimitConfig
	strictRateLimit: RateLimitConfig
	enableCORS?: boolean
	enableHelmet?: boolean
	trustedProxies?: string[]
}
