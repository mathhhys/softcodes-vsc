import React, { useState, useEffect } from 'react';
import { VSCodeButton, VSCodeTextField } from '@vscode/webview-ui-toolkit/react';
import { useTranslation } from 'react-i18next';
import SoftcodesBalanceDisplay from './SoftcodesBalanceDisplay';

interface SoftcodesProviderProps {
  apiConfiguration: any;
  setApiConfiguration: (config: any) => void;
  vscode: any;
}

export default function SoftcodesProvider({
  apiConfiguration,
  setApiConfiguration,
  vscode
}: SoftcodesProviderProps) {
  const { t } = useTranslation();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userInfo, setUserInfo] = useState<{
    email: string;
    firstName?: string;
    lastName?: string;
    organizationName?: string;
    organizationId?: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Check authentication status on mount
    checkAuthStatus();

    // Listen for authentication state changes
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'authStateChanged') {
        setIsAuthenticated(message.isAuthenticated);
        setUserInfo(message.softcodesUserInfo || null);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const checkAuthStatus = async () => {
    vscode.postMessage({ 
      type: 'checkSoftcodesAuth' 
    });
  };

  const handleSignIn = () => {
    setIsLoading(true);
    vscode.postMessage({ 
      type: 'softcodesSignIn' 
    });
    // Loading state will be cleared when we receive authStateChanged message
    setTimeout(() => setIsLoading(false), 5000); // Timeout fallback
  };

  const handleSignOut = () => {
    vscode.postMessage({ 
      type: 'softcodesSignOut' 
    });
    setIsAuthenticated(false);
    setUserInfo(null);
  };

  if (!isAuthenticated) {
    return (
      <div className="space-y-4">
        <div className="text-sm text-vscode-descriptionForeground">
          {t('settings.providers.softcodes.description')}
        </div>
        
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            {t('settings.providers.softcodes.signInRequired')}
          </p>
          <VSCodeButton 
            onClick={handleSignIn}
            disabled={isLoading}
            className="max-w-xs"
          >
            {isLoading ? t('common.loading') : t('settings.providers.softcodes.signIn')}
          </VSCodeButton>
        </div>

        <div className="text-xs text-vscode-descriptionForeground mt-4">
          <p>{t('settings.providers.softcodes.benefits.title')}</p>
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li>{t('settings.providers.softcodes.benefits.1')}</li>
            <li>{t('settings.providers.softcodes.benefits.2')}</li>
            <li>{t('settings.providers.softcodes.benefits.3')}</li>
            <li>{t('settings.providers.softcodes.benefits.4')}</li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-vscode-descriptionForeground">
        {t('settings.providers.softcodes.description')}
      </div>

      {userInfo && (
        <div className="bg-vscode-editor-background p-3 rounded border border-vscode-panel-border">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm font-medium">{userInfo.email}</p>
              {userInfo.firstName && userInfo.lastName && (
                <p className="text-xs text-vscode-descriptionForeground mt-1">
                  {userInfo.firstName} {userInfo.lastName}
                </p>
              )}
              {userInfo.organizationName && (
                <p className="text-xs text-vscode-descriptionForeground mt-1">
                  {t('settings.providers.softcodes.organization')}: {userInfo.organizationName}
                </p>
              )}
            </div>
            <VSCodeButton 
              appearance="secondary"
              onClick={handleSignOut}
            >
              {t('settings.providers.softcodes.signOut')}
            </VSCodeButton>
          </div>
        </div>
      )}

      <SoftcodesBalanceDisplay vscode={vscode} />

      <div className="space-y-2">
        <label className="text-sm font-medium">
          {t('settings.providers.softcodes.endpoint')}
        </label>
        <VSCodeTextField
          value={apiConfiguration.softcodesEndpoint || 'https://softcodes.ai'}
          onChange={(e: any) => {
            setApiConfiguration({
              ...apiConfiguration,
              softcodesEndpoint: e.target.value
            });
          }}
          placeholder="https://softcodes.ai"
          className="w-full"
        />
        <p className="text-xs text-vscode-descriptionForeground">
          {t('settings.providers.softcodes.endpointDescription')}
        </p>
      </div>

      <div className="mt-4 p-3 bg-vscode-textBlockQuote-background rounded">
        <p className="text-xs text-vscode-descriptionForeground">
          {t('settings.providers.softcodes.note')}
        </p>
      </div>
    </div>
  );
}