import { inject } from "@loopback/context";
import { FilterExcludingWhere, repository } from "@loopback/repository";
import { post, param, requestBody, HttpErrors } from "@loopback/rest";
import { Applications } from "../models";
import { ApplicationsRepository, BlockchainsRepository, LoadBalancersRepository } from "../repositories";
import { Pocket, Configuration } from "@pokt-network/pocket-js";
import { Redis } from "ioredis";
import { Pool as PGPool } from "pg";
import { CherryPicker } from '../services/cherry-picker';
import { MetricsRecorder } from '../services/metrics-recorder';
import { PocketRelayer } from "../services/pocket-relayer";

export class V1Controller {
  cherryPicker: CherryPicker;
  metricsRecorder: MetricsRecorder;
  pocketRelayer: PocketRelayer;

  constructor(
    @inject("secretKey") private secretKey: string,
    @inject("host") private host: string,
    @inject("origin") private origin: string,
    @inject("userAgent") private userAgent: string,
    @inject("contentType") private contentType: string,
    @inject("relayPath") private relayPath: string,
    @inject("pocketInstance") private pocket: Pocket,
    @inject("pocketConfiguration") private pocketConfiguration: Configuration,
    @inject("redisInstance") private redis: Redis,
    @inject("pgPool") private pgPool: PGPool,
    @inject("databaseEncryptionKey") private databaseEncryptionKey: string,
    @inject("processUID") private processUID: string,
    @repository(ApplicationsRepository)
    public applicationsRepository: ApplicationsRepository,
    @repository(BlockchainsRepository)
    private blockchainsRepository: BlockchainsRepository,
    @repository(LoadBalancersRepository)
    private loadBalancersRepository: LoadBalancersRepository
  ) {
    this.cherryPicker = new CherryPicker(
      this.redis,
      this.checkDebug()
    );
    this.metricsRecorder = new MetricsRecorder(
      this.redis,
      this.pgPool,
      this.cherryPicker,
      this.processUID
    );
    this.pocketRelayer = new PocketRelayer(
      this.host,
      this.origin,
      this.userAgent,
      this.pocket,
      this.pocketConfiguration,
      this.cherryPicker,
      this.metricsRecorder,
      this.redis,
      this.databaseEncryptionKey,
      this.secretKey,
      this.relayPath,
      this.blockchainsRepository,
      this.checkDebug()
    );
  }

  /**
   * Load Balancer Relay
   * 
   * Send a Pocket Relay using a Gateway Load Balancer ID
   * 
   * @param id Load Balancer ID
   */
  @post("/v1/lb/{id}", {
    responses: {
      "200": {
        description: "Relay Response",
        content: {
          "application/json": {},
        },
      },
    },
  })
  async loadBalancerRelay(
    @param.path.string("id") id: string,
    @requestBody({
      description: 'Relay Request',
      required: true,
      content: {
        'application/json': {
          // Skip body parsing
          'x-parser': 'raw',
        },
      },
    }) rawData: object,
    @param.filter(Applications, { exclude: "where" })
    filter?: FilterExcludingWhere<Applications>
  ): Promise<string> {
    console.log("PROCESSING LB " + id);

    const cachedLoadBalancer = await this.redis.get(id);
    let loadBalancer;

    if (!cachedLoadBalancer) {
      loadBalancer = await this.loadBalancersRepository.findById(id, filter);
      await this.redis.set(id, JSON.stringify(loadBalancer), "EX", 60);
    } else {
      loadBalancer = JSON.parse(cachedLoadBalancer);
    }
    
    // Fetch applications contained in this Load Balancer. Verify they exist and choose
    // one randomly for the relay.
    const application = await this.fetchRandomLoadBalancerApplication(loadBalancer.id, loadBalancer.applicationIDs, filter);
    return this.pocketRelayer.sendRelay(rawData, application);
  }

  /**
   * Application Relay
   * 
   * Send a Pocket Relay using a specific Application's ID
   * 
   * @param id Application ID
   */
  @post("/v1/{id}", {
    responses: {
      "200": {
        description: "Relay Response",
        content: {
          "application/json": {},
        },
      },
    },
  })
  async applicationRelay(
    @param.path.string("id") id: string,
    @requestBody({
      description: 'Relay Request',
      required: true,
      content: {
        'application/json': {
          // Skip body parsing
          'x-parser': 'raw',
        },
      },
    }) rawData: object,
    @param.filter(Applications, { exclude: "where" })
    filter?: FilterExcludingWhere<Applications>
  ): Promise<string> {
    console.log("PROCESSING APP " + id);
    
    const app = await this.fetchApp(id, filter);
    return this.pocketRelayer.sendRelay(rawData, app);
  }

  // Pull Load Balancer Applications from redis then DB
  async fetchRandomLoadBalancerApplication(id: string, applicationIDs: string[], filter: FilterExcludingWhere | undefined): Promise<Applications> {
    let verifiedIDs:string[] = [];
    const cachedLoadBalancerApplicationIDs = await this.redis.get("applicationIDs-" + id);

    // Fetch from DB if not found in redis
    if (!cachedLoadBalancerApplicationIDs) {
      for (const applicationID of applicationIDs) {
        const application = await this.fetchApp(applicationID, filter);
        if (application?.id) {
            verifiedIDs.push(application.id);
        }
      }
      await this.redis.set("applicationIDs-" + id, JSON.stringify(verifiedIDs), "EX", 60);
    } else {
      verifiedIDs = JSON.parse(cachedLoadBalancerApplicationIDs);
    }

    // Sanity check; make sure applications are configured for this LB
    if (verifiedIDs.length < 1)
    {
      throw new HttpErrors.Forbidden(
        "Load Balancer configuration invalid"
      );
    }
    return this.fetchApp(verifiedIDs[Math.floor(Math.random() * verifiedIDs.length)], filter);
  } 
  
  // Pull Application records from redis then DB
  async fetchApp(id: string, filter: FilterExcludingWhere | undefined): Promise<Applications> {
    const cachedApplication = await this.redis.get(id);

    if (!cachedApplication) {
      const application = await this.applicationsRepository.findById(id, filter);
      await this.redis.set(id, JSON.stringify(application), "EX", 60);
      return application;
    }
    return new Applications(JSON.parse(cachedApplication))
  }

  // Debug log for testing based on user agent
  checkDebug(): boolean {
    if (
      this.userAgent &&
      this.userAgent.toLowerCase().includes('pocket-debug')
      ) {
      return true;
    }
    return false;
  }
}
