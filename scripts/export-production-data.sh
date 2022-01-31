#!/bin/bash

echo "Downloading production collections";

for collection in "Applications" "Blockchains" "CronJobData" "LoadBalancers" "Nodes" "PaymentHistory" "PaymentMethods" "PendingTransactions" "Users" "NetworkData"; \
  do \
    echo "Downloading $collection..."; \

    mongoexport --uri=$MONGO_SRC_CONNECTION --collection=$collection --type=json --out=/data/$collection \

    echo "Done $collection..."; \
done;
