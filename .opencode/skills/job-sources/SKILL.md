---
name: job-sources
description: Standards for building permitted job discovery and application-source integrations.
---

Use a pluggable source architecture.

Prefer:
- official APIs
- documented feeds
- authorized integrations
- public career pages where automated access is allowed

Normalize:
- title
- company
- location
- remote type
- salary
- description
- requirements
- technologies
- posted date
- application URL
- application method

Always deduplicate.

Never bypass:
- CAPTCHA
- anti-bot controls
- authentication
- access controls
- rate limits
- detection systems

When automatic submission is not supported or allowed:
- preserve the application URL
- generate the application package
- mark the job ACTION_REQUIRED