export interface HttpResponse {
    status: number;
    json: unknown;
}
export declare function httpGet(url: string, headers?: Record<string, string>): Promise<HttpResponse>;
export declare function httpPost(url: string, body: unknown, headers?: Record<string, string>): Promise<HttpResponse>;
export declare function checkHostedFlowRequired(json: unknown): void;
//# sourceMappingURL=http.d.ts.map