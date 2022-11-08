# Developer's Guide

We use Visual Studio Code for developing LoopBack and recommend the same to our
users.

## VSCode setup

Install the following extensions:

- [eslint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)
- [prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Development workflow

### Visual Studio Code

1. Start the build task (Cmd+Shift+B) to run TypeScript compiler in the
   background, watching and recompiling files as you change them. Compilation
   errors will be shown in the VSCode's "PROBLEMS" window.

2. Execute "Run Rest Task" from the Command Palette (Cmd+Shift+P) to re-run the
   test suite and lint the code for both programming and style errors. Linting
   errors will be shown in VSCode's "PROBLEMS" window. Failed tests are printed
   to terminal output only.

### Other editors/IDEs

1. Open a new terminal window/tab and start the continuous build process via
   `npm run build:watch`. It will run TypeScript compiler in watch mode,
   recompiling files as you change them. Any compilation errors will be printed
   to the terminal.

2. In your main terminal window/tab, run `npm run test:dev` to re-run the test
   suite and lint the code for both programming and style errors. You should run
   this command manually whenever you have new changes to test. Test failures
   and linter errors will be printed to the terminal.

## PR workflow

1. Create a branch for your feature
2. Make your changes
3. Push your branch to GitHub
4. Open a pull request
5. Make sure the tests pass
6. Merge your pull request
7. Delete your branch

the `release-on-push` action will run on all changes to master, and create a new tag and release on GitHub. A dockerimage build will be triggered by the new tag, and published to the container registry.

> NOTES on PR workflow: if the PR has the label `release:major`, `release:minor`, or `release:patch`, this will override `bump_version_scheme`.