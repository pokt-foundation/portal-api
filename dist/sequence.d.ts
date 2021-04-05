import { FindRoute, InvokeMethod, ParseParams, Reject, RequestContext, Send, SequenceHandler } from '@loopback/rest';
export declare class GatewaySequence implements SequenceHandler {
    private dispatchURL;
    private pocketSessionBlockFrequency;
    private pocketBlockTime;
    private clientPrivateKey;
    private clientPassphrase;
    protected findRoute: FindRoute;
    protected parseParams: ParseParams;
    protected invoke: InvokeMethod;
    send: Send;
    reject: Reject;
    constructor(dispatchURL: string, pocketSessionBlockFrequency: number, pocketBlockTime: number, clientPrivateKey: string, clientPassphrase: string, findRoute: FindRoute, parseParams: ParseParams, invoke: InvokeMethod, send: Send, reject: Reject);
    handle(context: RequestContext): Promise<void>;
}
