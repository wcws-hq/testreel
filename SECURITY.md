# Security

Testreel runs untrusted code from the repos you give it, inside a Docker container with no mounts or secrets, and it signs in to your YouTube channel. Both deserve care.

## Reporting

Please report vulnerabilities privately through GitHub's "Report a vulnerability" button on the Security tab of this repository rather than a public issue.

## What to know

- The web server binds to `127.0.0.1` only. Do not expose it to a network: it can start containers and upload to your channel.
- Containers have internet access. Do not run repos you would not run in a normal container, and do not put secrets in `.env` files that a container could see (none are mounted).
- Your `.env` and `~/.testreel/.youtube/main.json` are secrets. If one leaks, rotate the API key, and remove Testreel at <https://myaccount.google.com/permissions>.
