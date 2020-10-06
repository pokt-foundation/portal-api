"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const context_1 = require("@loopback/context");
const repository_1 = require("@loopback/repository");
const rest_1 = require("@loopback/rest");
const models_1 = require("../models");
const repositories_1 = require("../repositories");
const pocket_js_1 = require("@pokt-network/pocket-js");
const pg_1 = require("pg");
const cherry_picker_1 = require("../services/cherry-picker");
const metrics_recorder_1 = require("../services/metrics-recorder");
const pocket_relayer_1 = require("../services/pocket-relayer");
let V1Controller = class V1Controller {
    constructor(secretKey, host, origin, userAgent, contentType, relayPath, relayRetries, pocket, pocketConfiguration, redis, pgPool, databaseEncryptionKey, processUID, applicationsRepository, blockchainsRepository, loadBalancersRepository) {
        this.secretKey = secretKey;
        this.host = host;
        this.origin = origin;
        this.userAgent = userAgent;
        this.contentType = contentType;
        this.relayPath = relayPath;
        this.relayRetries = relayRetries;
        this.pocket = pocket;
        this.pocketConfiguration = pocketConfiguration;
        this.redis = redis;
        this.pgPool = pgPool;
        this.databaseEncryptionKey = databaseEncryptionKey;
        this.processUID = processUID;
        this.applicationsRepository = applicationsRepository;
        this.blockchainsRepository = blockchainsRepository;
        this.loadBalancersRepository = loadBalancersRepository;
        this.cherryPicker = new cherry_picker_1.CherryPicker({
            redis: this.redis,
            checkDebug: this.checkDebug(),
        });
        this.metricsRecorder = new metrics_recorder_1.MetricsRecorder({
            redis: this.redis,
            pgPool: this.pgPool,
            cherryPicker: this.cherryPicker,
            processUID: this.processUID,
        });
        this.pocketRelayer = new pocket_relayer_1.PocketRelayer({
            host: this.host,
            origin: this.origin,
            userAgent: this.userAgent,
            pocket: this.pocket,
            pocketConfiguration: this.pocketConfiguration,
            cherryPicker: this.cherryPicker,
            metricsRecorder: this.metricsRecorder,
            redis: this.redis,
            databaseEncryptionKey: this.databaseEncryptionKey,
            secretKey: this.secretKey,
            relayPath: this.relayPath,
            relayRetries: this.relayRetries,
            blockchainsRepository: this.blockchainsRepository,
            checkDebug: this.checkDebug(),
        });
    }
    /**
     * Load Balancer Relay
     *
     * Send a Pocket Relay using a Gateway Load Balancer ID
     *
     * @param id Load Balancer ID
     */
    async loadBalancerRelay(id, rawData, filter) {
        console.log('PROCESSING LB ' + id);
        const loadBalancer = await this.fetchLoadBalancer(id, filter);
        if (loadBalancer === null || loadBalancer === void 0 ? void 0 : loadBalancer.id) {
            // Fetch applications contained in this Load Balancer. Verify they exist and choose
            // one randomly for the relay.
            const application = await this.fetchRandomLoadBalancerApplication(loadBalancer.id, loadBalancer.applicationIDs, filter);
            if (application === null || application === void 0 ? void 0 : application.id) {
                return this.pocketRelayer.sendRelay(rawData, application, parseInt(loadBalancer.requestTimeOut), parseInt(loadBalancer.overallTimeOut), parseInt(loadBalancer.relayRetries));
            }
        }
        throw new rest_1.HttpErrors.InternalServerError('Load Balancer configuration error');
    }
    /**
     * Application Relay
     *
     * Send a Pocket Relay using a specific Application's ID
     *
     * @param id Application ID
     */
    async applicationRelay(id, rawData, filter) {
        console.log('PROCESSING APP ' + id);
        const application = await this.fetchApplication(id, filter);
        if (application === null || application === void 0 ? void 0 : application.id) {
            return this.pocketRelayer.sendRelay(rawData, application);
        }
        throw new rest_1.HttpErrors.InternalServerError('Application not found');
    }
    // Pull LoadBalancer records from redis then DB
    async fetchLoadBalancer(id, filter) {
        const cachedLoadBalancer = await this.redis.get(id);
        if (!cachedLoadBalancer) {
            const loadBalancer = await this.loadBalancersRepository.findById(id, filter);
            if (loadBalancer === null || loadBalancer === void 0 ? void 0 : loadBalancer.id) {
                await this.redis.set(id, JSON.stringify(loadBalancer), 'EX', 60);
                return new models_1.LoadBalancers(loadBalancer);
            }
            return undefined;
        }
        return new models_1.LoadBalancers(JSON.parse(cachedLoadBalancer));
    }
    // Pull Application records from redis then DB
    async fetchApplication(id, filter) {
        const cachedApplication = await this.redis.get(id);
        if (!cachedApplication) {
            const application = await this.applicationsRepository.findById(id, filter);
            if (application === null || application === void 0 ? void 0 : application.id) {
                await this.redis.set(id, JSON.stringify(application), 'EX', 60);
                return new models_1.Applications(application);
            }
            return undefined;
        }
        return new models_1.Applications(JSON.parse(cachedApplication));
    }
    // Pull a random Load Balancer Application from redis then DB
    async fetchRandomLoadBalancerApplication(id, applicationIDs, filter) {
        let verifiedIDs = [];
        const cachedLoadBalancerApplicationIDs = await this.redis.get('applicationIDs-' + id);
        // Fetch from DB if not found in redis
        if (!cachedLoadBalancerApplicationIDs) {
            for (const applicationID of applicationIDs) {
                const application = await this.fetchApplication(applicationID, filter);
                if (application === null || application === void 0 ? void 0 : application.id) {
                    verifiedIDs.push(application.id);
                }
            }
            await this.redis.set('applicationIDs-' + id, JSON.stringify(verifiedIDs), 'EX', 60);
        }
        else {
            verifiedIDs = JSON.parse(cachedLoadBalancerApplicationIDs);
        }
        // Sanity check; make sure applications are configured for this LB
        if (verifiedIDs.length < 1) {
            throw new rest_1.HttpErrors.Forbidden('Load Balancer configuration invalid');
        }
        return this.fetchApplication(verifiedIDs[Math.floor(Math.random() * verifiedIDs.length)], filter);
    }
    // Debug log for testing based on user agent
    checkDebug() {
        if (this.userAgent &&
            this.userAgent.toLowerCase().includes('pocket-debug')) {
            return true;
        }
        return false;
    }
};
tslib_1.__decorate([
    rest_1.post('/v1/lb/{id}', {
        responses: {
            '200': {
                description: 'Relay Response',
                content: {
                    'application/json': {},
                },
            },
        },
    }),
    tslib_1.__param(0, rest_1.param.path.string('id')),
    tslib_1.__param(1, rest_1.requestBody({
        description: 'Relay Request',
        required: true,
        content: {
            'application/json': {
                // Skip body parsing
                'x-parser': 'raw',
            },
        },
    })),
    tslib_1.__param(2, rest_1.param.filter(models_1.Applications, { exclude: 'where' })),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], V1Controller.prototype, "loadBalancerRelay", null);
tslib_1.__decorate([
    rest_1.post('/v1/{id}', {
        responses: {
            '200': {
                description: 'Relay Response',
                content: {
                    'application/json': {},
                },
            },
        },
    }),
    tslib_1.__param(0, rest_1.param.path.string('id')),
    tslib_1.__param(1, rest_1.requestBody({
        description: 'Relay Request',
        required: true,
        content: {
            'application/json': {
                // Skip body parsing
                'x-parser': 'raw',
            },
        },
    })),
    tslib_1.__param(2, rest_1.param.filter(models_1.Applications, { exclude: 'where' })),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], V1Controller.prototype, "applicationRelay", null);
V1Controller = tslib_1.__decorate([
    tslib_1.__param(0, context_1.inject('secretKey')),
    tslib_1.__param(1, context_1.inject('host')),
    tslib_1.__param(2, context_1.inject('origin')),
    tslib_1.__param(3, context_1.inject('userAgent')),
    tslib_1.__param(4, context_1.inject('contentType')),
    tslib_1.__param(5, context_1.inject('relayPath')),
    tslib_1.__param(6, context_1.inject('relayRetries')),
    tslib_1.__param(7, context_1.inject('pocketInstance')),
    tslib_1.__param(8, context_1.inject('pocketConfiguration')),
    tslib_1.__param(9, context_1.inject('redisInstance')),
    tslib_1.__param(10, context_1.inject('pgPool')),
    tslib_1.__param(11, context_1.inject('databaseEncryptionKey')),
    tslib_1.__param(12, context_1.inject('processUID')),
    tslib_1.__param(13, repository_1.repository(repositories_1.ApplicationsRepository)),
    tslib_1.__param(14, repository_1.repository(repositories_1.BlockchainsRepository)),
    tslib_1.__param(15, repository_1.repository(repositories_1.LoadBalancersRepository)),
    tslib_1.__metadata("design:paramtypes", [String, String, String, String, String, String, Number, pocket_js_1.Pocket,
        pocket_js_1.Configuration, Object, pg_1.Pool, String, String, repositories_1.ApplicationsRepository,
        repositories_1.BlockchainsRepository,
        repositories_1.LoadBalancersRepository])
], V1Controller);
exports.V1Controller = V1Controller;
//# sourceMappingURL=v1.controller.js.map