module.exports = {
  '*.(t|j)s': ['eslint --fix', 'prettier --write .'],
  // Applies shared environments to all deployment artifacts
  '*pocket-gateway/**/*(shared-envs.json|*.yml)': 'npm run tasks:deploy:render-artifacts',
}
