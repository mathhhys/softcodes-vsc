import * as vscode from 'vscode';
import { UnifiedAuthService } from '../auth/unifiedAuthService';

export class ApiClient {
  private authService: UnifiedAuthService;
  private baseUrl: string;

  constructor(context: vscode.ExtensionContext) {
    this.authService = UnifiedAuthService.getInstance(context);
    const config = vscode.workspace.getConfiguration('softcodes');
    this.baseUrl = config.get('backendUrl') || 'https://softcodes.ai';
  }

  /**
   * Make authenticated API request
   */
  async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    const accessToken = await this.authService.getAccessToken();
    
    if (!accessToken) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 401) {
      // Token might be expired, try to refresh
      const newToken = await this.authService.getAccessToken();
      if (newToken && newToken !== accessToken) {
        // Retry with new token
        return this.request(endpoint, options);
      } else {
        // Re-authentication needed
        vscode.commands.executeCommand('softcodes.authenticate');
        throw new Error('Authentication required');
      }
    }

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'API request failed');
    }

    return response.json();
  }

  /**
   * Validate session
   */
  async validateSession(sessionToken: string, extensionVersion: string): Promise<any> {
    return this.request('/api/vscode/session/validate', {
      method: 'POST',
      body: JSON.stringify({ sessionToken, extensionVersion })
    });
  }

  /**
   * Track usage
   */
  async trackUsage(data: any): Promise<any> {
    return this.request('/api/vscode/usage/track', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  /**
   * Get user balance
   */
  async getUserBalance(): Promise<any> {
    return this.request('/api/vscode/user/balance');
  }

  /**
   * Get user subscription status
   */
  async getSubscriptionStatus(): Promise<any> {
    return this.request('/api/vscode/user/subscription');
  }

  /**
   * Submit task for processing
   */
  async submitTask(task: any): Promise<any> {
    return this.request('/api/vscode/tasks', {
      method: 'POST',
      body: JSON.stringify(task)
    });
  }

  /**
   * Get task status
   */
  async getTaskStatus(taskId: string): Promise<any> {
    return this.request(`/api/vscode/tasks/${taskId}`);
  }
}