# Play Store listing content

Drafted 2026-08-14, alongside the release-signing setup (see `PLAN.md`'s
"Play Store release signing" section).

- `short-description.txt` — 73/80 chars, Play's short description field.
- `full-description.txt` — Play's full description field (2284/4000 chars).
- `privacy-policy.md` — source of truth for the privacy policy text.
  **Published as a public Gist** (not GitHub Pages — the `WalkerLab`
  public repo is intentionally private right now, see
  `[[project_public_repo_split]]`/PLAN.md's repo-split notes, and private-repo
  Pages aren't publicly reachable):
  **https://gist.github.com/jaso1000/1b63cdc9c85736b37b55c7580c358b19**
  — this is the URL to paste into Play Console's privacy policy field.
  If `privacy-policy.md` is ever edited, re-publish with
  `gh gist edit <gist-id> store-listing/privacy-policy.md` (not
  `gist create`, which would mint a new URL) and update the "Last updated"
  line in the file first.
- `data-safety-notes.md` — draft answers/reasoning for Play Console's Data
  Safety questionnaire. Not a substitute for reading Play's actual current
  form before submitting.

Still needed before submission: screenshots, a feature graphic
(1024x500 — `assets/branding/` has source material to start from), and
actually filling in Play Console's listing/questionnaire with this
content.
