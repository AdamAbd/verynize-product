# Contributing

Open an issue describing substantial changes before implementation. Fork the repository, create a branch, and keep changes focused. Read README.md and AGENTS.md for local setup and validation. Use the committed lockfile with `npm ci` where applicable.

Product and marketing are separate repositories. Submit changes in the relevant repository; the parent workspace updates submodule pointers after those commits are available remotely. For a fork of the workspace, update `.gitmodules` URLs to your own submodule forks when needed.

Include the problem, resulting behavior, and checks run in each pull request. UI changes should include screenshots using your own sample data. Never attach credentials, real invite links, or private designs. Do not copy proprietary code, prompts, screenshots, or assets without redistribution rights; retain third-party notices.

Run product checks from `verynize-product`: `npm run build:ui`, `npm run check`, and suites relevant to the change. UI source changes additionally require `npm run lint:ui` and `npm run typecheck:ui`. Run marketing checks from `verynize-marketing`: `npm run build`, `npm run typecheck`, and `npm test`. Within a standalone submodule checkout, run these from its root.

Use your own cloud resources for integration testing. Production deployment belongs to maintainers. Follow SECURITY.md for vulnerability reports.

Contributions of original work are submitted under the MIT License. Only contribute material you have the right to license, and identify any third-party material and its applicable license.
