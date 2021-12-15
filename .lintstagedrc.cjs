module.exports = {
  '*.(t|j)s': ['eslint --fix', 'prettier --write .'],
  // Renders change of a template to a single deployment artifact
  '*pocket-gateway/**/*.yml': (filenames) =>
    filenames.map((filename) => {
      return `cp ${filename} .github/workflows`
    }),
  // Applies shared environments to all deployment artifacts
  '*pocket-gateway/**/*shared-envs.json': 'npm run tasks:deploy:render-artifacts',
}
