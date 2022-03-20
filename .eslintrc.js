module.exports = {
  root: true,
  env: {
    es6: true,
    mocha: true,
    node: true,
    mongo: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: './',
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    '@loopback/eslint-config',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/errors',
    'plugin:import/warnings',
    'plugin:import/typescript',
  ],
  settings: {
    'import/parsers': {
      '@typescript-eslint/parser': ['.ts', '.tsx'],
    },
    'import/resolver': {
      node: {
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
      },
      alphabetize: {
        order: 'desc',
        caseInsensitive: true,
      },
    },
  },
  rules: {
    'no-console': 'off',
    'arrow-parens': ['error', 'always'],
    'comma-spacing': 'error',
    semi: ['error', 'never'],
    'no-unused-vars': 'off',
    eqeqeq: 'error',
    'no-alert': 'error',
    curly: 'error',
    'brace-style': ['error', '1tbs'],
    'object-curly-spacing': ['error', 'always'],
    'one-var-declaration-per-line': ['error', 'always'],
    'import/no-named-as-default-member': 'off',
    'import/no-named-as-default': 'off',
    'import/default': 'off',
    'import/namespace': 'off',
    'import/order': [
      'error',
      {
        groups: ['builtin', 'external', 'internal'],
        pathGroups: [
          {
            pattern: '@loopback/**',
            group: 'external',
            position: 'after',
          },
          {
            pattern: '@pokt-network/**',
            group: 'external',
            position: 'after',
          },
          {
            pattern: '@influxdata/**',
            group: 'external',
            position: 'after',
          },
        ],
        pathGroupsExcludedImportTypes: ['@loopback/**', '@pokt-network/**', '@influxdata/**'],
        alphabetize: {
          order: 'asc',
          caseInsensitive: true,
        },
      },
    ],
    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/no-extra-semi': ['off'],
    '@typescript-eslint/naming-convention': [
      'error',
      {
        selector: 'variable',
        format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
        leadingUnderscore: 'allow',
      },
    ],
    '@typescript-eslint/ban-types': [
      'error',
      {
        types: {
          object: false,
        },
        extendDefaults: true,
      },
    ],
    '@typescript-eslint/ban-ts-comment': 'off',
  },
}
