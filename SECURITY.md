# Security policy

Report vulnerabilities privately using this repository's **Security → Report a vulnerability** tab. Do not put credentials, private designs, invite links, or exploit details in public issues. If reporting is unavailable, contact @AdamAbd privately before disclosing details.

Only the current main branch receives security fixes. Hosted services and self-hosted installations may run different revisions.

Never commit API tokens, session cookies, `.env` / `.dev.vars` files, private keys, or local Cloudflare state. Examples must contain placeholders only. If a credential enters Git history, revoke or rotate it first; deleting the file or adding a gitignore rule does not revoke it.

Forks must use their own accounts and credentials. Do not run unreviewed pull-request code with production secrets. Review dependency install scripts and workflow changes before deploying.
