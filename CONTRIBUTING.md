# Contributing

Thanks for contributing.

## Ground Rules

- Keep changes focused and scoped to one concern.
- Prefer small pull requests over large multi-topic changes.
- Write or update tests when behavior changes.
- Preserve existing coding patterns unless there is a clear reason to improve them.

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment template:

```bash
cp .env.example .env
```

On Windows (PowerShell):

```powershell
Copy-Item .env.example .env
```

3. Set required variables:

- `BOT_TOKEN`
- `MONGODB_URI`

For realistic local runs, also verify:

- `API_BASE` and `GATEWAY_URL` still point to the intended Fluxer endpoints
- `ffmpeg` is available
- `yt-dlp` is installed if you want reliable YouTube playback/testing

4. Start development mode:

```bash
npm run dev
```

## Test and Validation

Run the full test suite before opening a PR:

```bash
npm test
```

If you touched command parsing, queue logic, or session lifecycle, add targeted tests in `test/`.

If you changed runtime behavior, commands, persistence, or env vars, update the relevant Markdown docs in the same change.

## Pull Request Checklist

- [ ] My change has a clear scope and rationale.
- [ ] I added or updated tests for behavior changes.
- [ ] I ran `npm test` locally.
- [ ] I updated docs if config, commands, or operations changed.
- [ ] I did not commit secrets or local environment artifacts.

## Commit Messages

Use concise, descriptive commit messages.

Examples:

- `fix(player): handle empty playlist page safely`
- `docs(readme): document yt-dlp cookie fallback`
- `test(queue): cover playnext ordering`

## Contributor License Grant

By submitting a contribution (code, docs, tests, assets), You grant Licensor a perpetual,
worldwide, irrevocable, royalty-free right to use, modify, relicense, and distribute that
contribution as part of this project under any license terms chosen by Licensor.

## Reporting Bugs

Use the GitHub bug report template and include:

- reproduction steps
- expected vs actual behavior
- logs or stack trace (redact secrets)
- runtime details (Node version, OS, deployment mode)
