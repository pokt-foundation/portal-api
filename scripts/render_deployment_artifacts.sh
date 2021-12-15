#!/bin/bash

# adds shared data to deployment files to mainly avoid misconfiguration due to
# copy/pasting

github_path=".github/workflows"
template_path="pocket-gateway/tasks"
shared_data="shared-envs.json"

patterns=("canary*.yml" "production*.yml" "staging*.yml")

for pattern in "${patterns[@]}" 
  do
  patternFiles=$(find $template_path  -name $pattern)
  for file in $patternFiles
  do
    echo $file
    name=$(basename $file)
    destination_path=$github_path/$name

    mustache $template_path/$shared_data $file \
    > $destination_path

    git add $destination_path
  done
done