# pocket-gateway

#### How to run locally

Make sure you prepare your env:
```
$ cp .env.example .env
```

and replace relevant keys with proper values.


Then spin up the gateway alongside its dependencies.
```
$ docker-compose up
```

If you need to populate the database with a production replica,
make sure you create tasks.env by:
```
$ cp .tasks.env.example .tasks.env
```

Replace `_SRC_` env variables with the gateway production values
and `_DEST_` with the same values as `MONGO_INIT` values, then run:

1. To retrieve production data
```
$ docker-compose up retrieve-prod-data
```

2. To persist the retrieved data
```
$ docker-compose up import-production-data
```

And you are good to go.

#### Missing
[ ] Nodemon and hot reload for dev purposes.