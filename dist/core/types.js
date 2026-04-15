"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OneloError = void 0;
class OneloError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'OneloError';
    }
    static notAuthenticated() {
        return new OneloError('not_authenticated', 'User is not authenticated');
    }
    static hostedFlowRequired() {
        return new OneloError('hosted_flow_required', 'This app requires the hosted sign-in flow. Use loadAuthView().');
    }
    static planRequired() {
        return new OneloError('plan_required', 'Custom UI requires a paid Onelo plan. Use loadAuthView() instead.');
    }
    static invalidKey(msg) {
        return new OneloError('invalid_publishable_key', `Invalid publishable key: ${msg}`);
    }
    static network(msg) {
        return new OneloError('network_error', `Network error: ${msg}`);
    }
    static server(msg) {
        return new OneloError('server_error', msg);
    }
    static cancelled() {
        return new OneloError('cancelled', 'Sign in was cancelled');
    }
    static revoked() {
        return new OneloError('revoked', 'This application has been revoked');
    }
    static userRevoked() {
        return new OneloError('user_revoked', 'This user account has been suspended');
    }
}
exports.OneloError = OneloError;
//# sourceMappingURL=types.js.map