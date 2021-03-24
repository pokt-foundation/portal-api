#!/bin/bash

echo "Downloading production collections";

for collection in "Applications" "Blockchains" "CronJobData" "LoadBalancers" "Nodes" "PaymentHistory" "PaymentMethods" "PendingTransactions" "Users"; \
  do \
    echo "Downloading $collection..."; \

    mongoexport \
        --uri mongodb+srv://$MONGO_SRC_USER:$MONGO_SRC_PW@$MONGO_SRC_HOST/$MONGO_SRC_DB \
        --collection "$collection" \
        --type json \
        --out /data/$collection; \

    echo "Downloaded $collection..."; \
done;
