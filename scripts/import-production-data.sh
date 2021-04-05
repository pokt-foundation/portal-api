#!/bin/bash

echo "Starting mongodb";

mongod &

echo "Waiting...";

sleep 5s

echo "Persisting production collections";

for collection in "Applications" "Blockchains" "CronJobData" "LoadBalancers" "Nodes" "PaymentHistory" "PaymentMethods" "PendingTransactions" "Users"; \
  do \
    echo "Persisting $collection collection..."; \
   
    mongoimport \
        --uri mongodb://$MONGO_DEST_USER:$MONGO_DEST_PW@$MONGO_DEST_HOST/$MONGO_DEST_DB?authSource=admin \
        --collection "$collection" \
        --type json \
        --file /data/$collection; \

    echo "Persisted $collection collection successfully..."; \
done;
