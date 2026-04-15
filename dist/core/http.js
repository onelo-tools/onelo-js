"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.httpGet = httpGet;
exports.httpPost = httpPost;
exports.checkHostedFlowRequired = checkHostedFlowRequired;
const types_1 = require("./types");
async function httpGet(url, headers) {
    let res;
    try {
        res = await fetch(url, { headers });
    }
    catch (e) {
        throw types_1.OneloError.network(e instanceof Error ? e.message : 'fetch failed');
    }
    const json = await parseJson(res);
    return { status: res.status, json };
}
async function httpPost(url, body, headers) {
    let res;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body),
        });
    }
    catch (e) {
        throw types_1.OneloError.network(e instanceof Error ? e.message : 'fetch failed');
    }
    const json = await parseJson(res);
    return { status: res.status, json };
}
async function parseJson(res) {
    try {
        return await res.json();
    }
    catch {
        throw types_1.OneloError.network('Invalid JSON response');
    }
}
function checkHostedFlowRequired(json) {
    const j = json;
    const errorCode = j['error'] ??
        j['detail']?.['error'];
    if (errorCode === 'hosted_flow_required') {
        const hint = j['hint'] ??
            j['detail']?.['hint'] ??
            'Use loadAuthView() in your web app.';
        console.warn('[Onelo] ⚠️  hosted_flow_required:', hint);
        console.info('[Onelo] 💡 Fix: call onelo.auth.loadAuthView() or upgrade your Onelo plan.');
        throw types_1.OneloError.hostedFlowRequired();
    }
}
//# sourceMappingURL=http.js.map