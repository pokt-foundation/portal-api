#!/bin/bash

# adds shared data to deployment files to mainly avoid misconfiguration due to
# copy/pasting

github_path=".github/workflows"
template_path="pocket-gateway/tasks"
shared_data="shared-envs.json"

patterns=("canary*.yml" "production*.yml" "staging*.yml")

for pattern in "${patterns[@]}" 
  do
  files=$(find $template_path  -name $pattern)
  for file in $files
  do
    name=$(basename $file)
    destination=$github_path/$name

    mustache $template_path/$shared_data $file \
    > $destination

    git add $destination
  done
done