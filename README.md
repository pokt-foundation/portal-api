# pocket-gateway

#### How to run locally


#### Run against production 

If you need to populate the database with a production replica,
make sure you create tasks.env by:
```
$ cp .tasks.env.example .tasks.env
```

Replace `_SRC_` env variables with the gateway production values
and `_DEST_` with the same values as `MONGO_INIT` values, then run:

1. To retrieve production data
```
$ npm run tasks:db:download-production-data
```
or
```
$ docker-compose -f tasks.yml up download-production-data
```

2. To persist the retrieved data

```
$ npm run tasks:db:persist-production-data
```
And you are good to go.

##### Spin everything locally

Make sure you prepare your env:
```
$ cp .env.example .env
```

and replace relevant keys with proper values.

Then spin up the gateway alongside its dependencies.
```
$ npm run services:all:up
```

#### Missing
[ ] Nodemon and hot reload for dev purposes.