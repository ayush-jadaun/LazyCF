# LazyCf

**LazyCf** is a VS Code extension to interact with [Codeforces](https://codeforces.com):

- Browse & search contests and problems.
- View problem statements in Markdown.
- Auto-create source files with problem info and sample testcases.
- Run your code on sample inputs locally for C++, Python, and Java.
- Submit directly to Codeforces and track verdicts.
- Securely store your Codeforces API Key & Secret.

## Installation

1. Clone/download this repo.
2. `npm install`
3. `npm run build`
4. In VS Code, select "Run Extension".

## Usage

- **Authenticate**: Run `LazyCf: Authenticate` and input your Codeforces API Key & Secret (see [here](https://codeforces.com/settings/api)).
- **Browse Contests**: `LazyCf: Browse Contests`
- **Fetch Problem**: `LazyCf: Fetch Problem` (by ID, tag, or rating)
- **Run Sample Tests**: `LazyCf: Run Sample Tests` (on open file)
- **Submit Solution**: `LazyCf: Submit Solution` (on open file)

## Notes

- Sample inputs/outputs are placeholders (API does not provide them). Use your own or see [cf-downloader](https://github.com/xalanq/cf-tool) for scraping samples.
- Supported languages: C++, Python, Java.
- Uses system compilers (`g++`, `python3`, `javac`, etc.) in PATH.

## Security

- Your API key/secret is stored securely using VS Code's global state.

## Roadmap

- [ ] Auto-scrape sample testcases.
- [ ] More language support.
- [ ] Contest reminders/notifications.