/**
 * AuthModal — iframe overlay for hosted sign-in flow.
 * Equivalent of WKWebView (Swift) and BrowserWindow (Electron).
 */
export type AuthModalCallback = {
    type: 'code';
    code: string;
} | {
    type: 'cancelled';
} | {
    type: 'error';
    message: string;
};
export declare class AuthModal {
    private overlay;
    private messageHandler;
    private readonly allowedOrigin;
    constructor(apiUrl: string);
    open(hostedUrl: string): Promise<AuthModalCallback>;
    close(): void;
    private buildOverlay;
}
//# sourceMappingURL=auth-modal.d.ts.map