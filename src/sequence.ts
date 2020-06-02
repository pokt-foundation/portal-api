import {inject} from '@loopback/context';
import {
  FindRoute,
  InvokeMethod,
  ParseParams,
  Reject,
  RequestContext,
  RestBindings,
  Send,
  SequenceHandler,
} from '@loopback/rest';

const SequenceActions = RestBindings.SequenceActions;

export class GatewaySequence implements SequenceHandler {
  constructor(
    @inject(SequenceActions.FIND_ROUTE) protected findRoute: FindRoute,
    @inject(SequenceActions.PARSE_PARAMS) protected parseParams: ParseParams,
    @inject(SequenceActions.INVOKE_METHOD) protected invoke: InvokeMethod,
    @inject(SequenceActions.SEND) public send: Send,
    @inject(SequenceActions.REJECT) public reject: Reject,
  ) {}

  async handle(context: RequestContext) {
    try {
      const {request, response} = context;

      // Record the host, user-agent, and origin for processing
      context.bind("host").to(request.headers['host']);
      context.bind("userAgent").to(request.headers['user-agent']);
      context.bind("origin").to(request.headers['origin']);
      context.bind("contentType").to(request.headers['content-type']);

      let secretKey = "";
      // SecretKey passed in via basic http auth
      if (request.headers['authorization']) { 
        const base64Credentials =  request.headers['authorization'].split(' ')[1];
        const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii').split(':');
        if (credentials[1]) {
          secretKey = credentials[1];
        }
      }
      context.bind("secretKey").to(secretKey);

      const route = this.findRoute(request);
      const args = await this.parseParams(request, route);
      const result = await this.invoke(route, args);
      this.send(response, result);
    } catch (err) {
      this.reject(context, err);
    }
  }
}
