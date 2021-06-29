# pocket-gateway

#### Populate environment variables
```
$ cp .tasks.env.example .tasks.env
$ cp .env.example .env
```

#### Importing production data
1. To retrieve production data
```
$ docker-compose -f tasks.yml up download-production-data
```

2. To import the retrieved data
```
$ docker-compose -f tasks.yml up import-production-data
```

##### Spin up all services locally
```
$ npm install
$ npm run services:all:up
```

#### Missing
[ ] Nodemon and hot reload for dev purposes.