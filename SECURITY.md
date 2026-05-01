# Security Policy

Ghost Writer is a self-hosted application that handles personal interview
content, signed access tokens, and (optionally) GitHub credentials. This
document describes how to report a suspected vulnerability and what is in
scope.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Use GitHub's private vulnerability reporting on this repository:

1. Open the repository on GitHub.
2. Go to the **Security** tab.
3. Click **Report a vulnerability** to open a confidential advisory.
4. Include a description, steps to reproduce or a proof of concept, your
   assessment of impact, and any suggested mitigation.

A response is not guaranteed within a fixed timeframe — this is a
volunteer-run project — but reports are reviewed and good-faith reporters
will receive an acknowledgement when triage happens.

## Scope

In scope for this policy:

- Credential leakage (GitHub tokens, JWT secrets, API keys) by the app.
- Authentication or authorization bypass on author or interviewee paths.
- Path traversal in the repo reader / writer / committer.
- JWT forgery, token replay, or session takeover on the
  `/s/[token]` route.
- Cross-interview data leakage (one interviewee seeing another's content).
- Exfiltration of book repo material to an interviewee.
- Injection in any subprocess invocation.

Out of scope:

- Issues that require physical access to the machine running the app.
- Bugs in upstream dependencies (Claude CLI, libsql, Next.js, etc.) that
  Ghost Writer simply re-exposes — please report those upstream.
- Denial of service via prompt size, cost-amplification attacks, or rate
  limiting on the underlying Claude account.

## Threat model

For context when evaluating reports:

- Ghost Writer is **single-tenant per deploy**. Each running instance
  trusts one author.
- The interviewee is **untrusted**. All routes under `/s/[token]` must
  treat the JWT as the only signal of identity, must enforce
  per-session isolation, and must never expose book context that wasn't
  on the per-template allow-list.
- Author Claude credentials and (optional) GitHub PAT live in `.env` on
  the host. Anyone with shell access to the host can read them; that's
  an accepted risk of self-hosting.
- Repo writes go through `lib/repo/writer.ts` (`_pendiente-` prefix) or
  `lib/repo/committer.ts` (direct push, opt-in). Both validate that the
  destination path resolves inside the configured book clone.

## Hardening checklist for self-hosters

- Generate a fresh `JWT_SECRET` (≥32 bytes from `crypto.randomBytes`).
  Don't reuse the example value.
- Use a fine-grained `GITHUB_TOKEN` scoped to exactly the book repo with
  Read+Write to Contents only. Avoid classic tokens with full `repo`
  scope.
- Run the app on a private network; expose to interviewees via a
  Cloudflare Tunnel or equivalent ingress, not by opening a port.
- Don't put `data/` on a synced cloud drive (OneDrive, Dropbox) — sync
  conflicts have caused issues during writes.
- Rotate `JWT_SECRET` periodically. All previously issued links become
  invalid; this is by design.

## Disclosure history

No reported issues yet.
