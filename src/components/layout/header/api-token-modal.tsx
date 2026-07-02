import React, { useState, useCallback, useRef } from 'react';
import { Localize } from '@deriv-com/translations';
import { isProduction } from '@/components/shared';
import './api-token-modal.scss';

type ApiTokenModalProps = {
    onClose: () => void;
};

const DERIV_TOKEN_URL = 'https://app.deriv.com/account/api-token';

/** Validate a Deriv API token by opening a temporary WebSocket and sending authorize. */
const validateDerivApiToken = (token: string, appId: string): Promise<{
    loginid: string;
    balance: number;
    currency: string;
    is_virtual: number;
    email: string;
    fullname: string;
    account_list: { loginid: string; currency: string; is_virtual: number }[];
}> => {
    return new Promise((resolve, reject) => {
        // Use the production or staging Deriv WS based on environment
        const server = isProduction() ? 'ws.derivws.com' : 'ws.derivws.com';
        const wsUrl = `wss://${server}/websockets/v3?app_id=${appId}`;
        let settled = false;
        let didOpen = false;

        const ws = new WebSocket(wsUrl);

        const fail = (msg: string) => {
            if (!settled) {
                settled = true;
                try { ws.close(); } catch (_) { /* ignore */ }
                reject(new Error(msg));
            }
        };

        const timer = setTimeout(() => fail('Connection timed out. Please try again.'), 12000);

        ws.onopen = () => {
            didOpen = true;
            ws.send(JSON.stringify({ authorize: token }));
        };

        ws.onmessage = (event: MessageEvent) => {
            if (settled) return;
            try {
                const data = JSON.parse(event.data as string);
                clearTimeout(timer);
                settled = true;
                ws.close();

                if (data.error) {
                    reject(new Error(data.error.message || 'Invalid token'));
                    return;
                }
                if (data.msg_type === 'authorize' && data.authorize) {
                    resolve(data.authorize);
                } else {
                    reject(new Error('Unexpected response from server'));
                }
            } catch {
                fail('Failed to parse server response');
            }
        };

        ws.onerror = () => {
            // Browsers withhold WebSocket error detail for security; the close
            // event (fired right after) carries the actual code/reason, so we
            // log it here for debugging and let onclose produce the user message.
            console.error('[ApiTokenModal] WebSocket error while connecting to', wsUrl);
        };
        ws.onclose = (ev) => {
            if (!settled) {
                clearTimeout(timer);
                console.error('[ApiTokenModal] WebSocket closed', { code: ev.code, reason: ev.reason, didOpen });
                if (!didOpen) {
                    // Connection never opened: almost always a network-level block
                    // (ad blocker/extension, corporate firewall/proxy, VPN, or DNS
                    // blocking ws.derivws.com) rather than a bad token.
                    fail('Could not reach Deriv\'s servers. This is usually caused by a browser extension (ad blocker), firewall, or VPN blocking WebSocket connections to ws.derivws.com — try disabling extensions or switching networks.');
                } else {
                    fail(ev.reason || `Connection closed unexpectedly (code ${ev.code}).`);
                }
            }
        };
    });
};

const ApiTokenModal: React.FC<ApiTokenModalProps> = ({ onClose }) => {
    const [token, setToken] = useState('');
    const [showToken, setShowToken] = useState(false);
    const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
    const [errorMsg, setErrorMsg] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const handleConnect = useCallback(async () => {
        const trimmed = token.trim();
        if (!trimmed) {
            setErrorMsg('Please enter your API token.');
            setStatus('error');
            return;
        }

        const appId = process.env.NEXT_PUBLIC_DERIV_APP_ID;
        if (!appId) {
            setErrorMsg('App configuration is missing. Please contact support.');
            setStatus('error');
            return;
        }

        setStatus('loading');
        setErrorMsg('');

        try {
            const authData = await validateDerivApiToken(trimmed, appId);

            // Store the token in sessionStorage (cleared on tab close; not persisted
            // across sessions — better XSS posture than localStorage for raw API tokens).
            sessionStorage.setItem('api_token_direct', trimmed);
            sessionStorage.setItem('api_token_mode', '1');
            localStorage.setItem('active_loginid', authData.loginid);
            localStorage.setItem('account_type', authData.is_virtual ? 'demo' : 'real');

            // Build a minimal accounts list for DerivWSAccountsService.getStoredAccounts()
            const accountsList = (authData.account_list ?? [{ loginid: authData.loginid, currency: authData.currency, is_virtual: authData.is_virtual }])
                .map((acc: { loginid: string; currency: string; is_virtual: number }) => ({
                    account_id: acc.loginid,
                    balance: '0',
                    currency: acc.currency || authData.currency || 'USD',
                    group: '',
                    status: 'active',
                    account_type: acc.is_virtual ? 'demo' : 'real',
                }));

            sessionStorage.setItem('deriv_accounts', JSON.stringify(accountsList));

            // Reload to let the normal auth flow pick up the stored token
            window.location.reload();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Authentication failed.';
            setErrorMsg(message);
            setStatus('error');
        }
    }, [token]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleConnect();
        if (e.key === 'Escape') onClose();
    };

    return (
        <div className='api-token-modal__overlay' onClick={onClose} onKeyDown={handleKeyDown} role='dialog' aria-modal='true' aria-label='Connect with API Token'>
            <div className='api-token-modal__box' onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className='api-token-modal__header'>
                    <div className='api-token-modal__title'>
                        <span className='api-token-modal__icon'>🔑</span>
                        <Localize i18n_default_text='Connect with API Token' />
                    </div>
                    <button className='api-token-modal__close' onClick={onClose} aria-label='Close'>✕</button>
                </div>

                {/* Body */}
                <div className='api-token-modal__body'>
                    <p className='api-token-modal__desc'>
                        <Localize i18n_default_text='Enter your Deriv API token to connect directly without OAuth.' />
                    </p>

                    <div className='api-token-modal__field'>
                        <label className='api-token-modal__label' htmlFor='api-token-input'>
                            <Localize i18n_default_text='API Token' />
                        </label>
                        <div className='api-token-modal__input-wrap'>
                            <input
                                ref={inputRef}
                                id='api-token-input'
                                className={`api-token-modal__input ${status === 'error' ? 'api-token-modal__input--error' : ''}`}
                                type={showToken ? 'text' : 'password'}
                                value={token}
                                onChange={e => { setToken(e.target.value); setStatus('idle'); setErrorMsg(''); }}
                                onKeyDown={handleKeyDown}
                                placeholder='a1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
                                autoComplete='off'
                                spellCheck={false}
                                disabled={status === 'loading'}
                            />
                            <button
                                type='button'
                                className='api-token-modal__eye'
                                onClick={() => setShowToken(v => !v)}
                                aria-label={showToken ? 'Hide token' : 'Show token'}
                                tabIndex={-1}
                            >
                                {showToken ? '🙈' : '👁️'}
                            </button>
                        </div>
                        {errorMsg && (
                            <p className='api-token-modal__error-msg'>{errorMsg}</p>
                        )}
                    </div>

                    <a
                        className='api-token-modal__link'
                        href={DERIV_TOKEN_URL}
                        target='_blank'
                        rel='noreferrer noopener'
                    >
                        <Localize i18n_default_text='Get your API token at app.deriv.com →' />
                    </a>

                    <div className='api-token-modal__hint'>
                        <Localize i18n_default_text='Make sure your token has Read and Trade permissions.' />
                    </div>
                </div>

                {/* Footer */}
                <div className='api-token-modal__footer'>
                    <button className='api-token-modal__cancel' onClick={onClose} disabled={status === 'loading'}>
                        <Localize i18n_default_text='Cancel' />
                    </button>
                    <button
                        className={`api-token-modal__connect ${status === 'loading' ? 'api-token-modal__connect--loading' : ''}`}
                        onClick={handleConnect}
                        disabled={status === 'loading' || !token.trim()}
                    >
                        {status === 'loading' ? (
                            <span className='api-token-modal__spinner' />
                        ) : null}
                        <Localize i18n_default_text={status === 'loading' ? 'Connecting…' : 'Connect'} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ApiTokenModal;
