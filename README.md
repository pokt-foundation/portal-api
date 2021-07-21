# Pocket Gateway

Access the full range of Pocket Network's supported blockchains through a single URL.

[![All Contributors](https://img.shields.io/badge/all_contributors-5-orange.svg?style=flat-square)](#contributors) [![Build Status](https://img.shields.io/github/workflow/status/pokt-foundation/portal-api/Production%20Deployment%20us-west-2?style=flat-square)](https://github.com/pokt-foundation/portal-api/actions)

<!-- markdownlint-disable -->
<div>
    <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg"/></a>
    <a href="https://github.com/pokt-foundation/portal-api/pulse"><img src="https://img.shields.io/github/last-commit/pokt-foundation/portal-api"/></a>
    <a href="https://github.com/pokt-foundation/portal-api/pulls"><img src="https://img.shields.io/github/issues-pr/pokt-foundation/portal-api.svg"/></a>
    <a href="https://github.com/pokt-foundation/portal-api/issues"><img src="https://img.shields.io/github/issues-closed/pokt-foundation/portal-api.svg"/></a>
</div>
<!-- markdownlint-restore -->

## Quick start

Only the steps 1 and 2 are required, steps 3 and 4 are only needed if you want to
bootstrap the app with existing data.

<!-- markdownlint-disable -->

1. Run the following commands to copy the environment variables and optionally replace them with your own.

   ```
   $ cp .tasks.env.example .tasks.env
   $ cp .env.example .env
   ```

2. Spin up all services locally (requires docker and docker-compose)

   ```
   $ npm install
   $ npm run services:all:up
   ```

3. Download the production data in your machine.

   ```bash

   $ npm run tasks:db:download-production-data
   ```

4. Retrieve the production data to be imported into the local app.
   ```bash
   $ npm run tasks:db:import-production-data
   ```

<!-- markdownlint-restore -->

**Hint**: If you still got issues about compiling when running the project after following at least the steps 1 and 2, run the command `npm run clean` and then `npm run services:all:up` again.

## Support & Contact

If you come across an issue with the Portal, do a search in the [Issues](https://github.com/pokt-foundation/portal/issues) tab of this repo to make sure it hasn't been reported before. Follow these steps to help us prevent duplicate issues and unnecessary notifications going to the many people watching this repo:

- If the issue you found has been reported and is still open, and the details match your issue, give a "thumbs up" to the relevant posts in the issue thread to signal that you have the same issue. No further action is required on your part.
- If the issue you found has been reported and is still open, but the issue is missing some details, you can add a comment to the issue thread describing the additional details.
- If the issue you found has been reported but has been closed, you can comment on the closed issue thread and ask to have the issue reopened because you are still experiencing the issue. Alternatively, you can open a new issue, reference the closed issue by number or link, and state that you are still experiencing the issue. Provide any additional details in your post, so we can better understand the issue and how to fix it.

<!-- markdownlint-disable -->
<div>
  <a  href="https://twitter.com/poktnetwork" ><img src="https://img.shields.io/twitter/url/http/shields.io.svg?style=social"></a>
  <a href="https://t.me/POKTnetwork"><img src="https://img.shields.io/badge/Telegram-blue.svg"></a>
  <a href="https://www.facebook.com/POKTnetwork" ><img src="https://img.shields.io/badge/Facebook-red.svg"></a>
  <a href="https://research.pokt.network"><img src="https://img.shields.io/discourse/https/research.pokt.network/posts.svg"></a>
</div>
<!-- markdownlint-restore -->

## License

This project is licensed under the MIT License; see the [LICENSE.md](LICENSE.md) file for details.
