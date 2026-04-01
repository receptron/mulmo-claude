# MulmoClaude

Experience GUI-chat! You chat with Claude Code, and it responds not just with text but with interactive visual tools — documents, spreadsheets, mind maps, images, forms, 3D scenes, piano, and more.

## Installation

**Prerequisites**: Node.js 18+, [Claude Code CLI](https://claude.ai/code) installed and authenticated.

```bash
# Clone the repository
git clone git@github.com:receptron/mulmoclaude.git
cd mulmoclaude

# Install dependencies
yarn install

# Set up environment variables
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY
```

## Running the App

```bash
yarn dev
```

This starts both the frontend (Vite) and the backend (Express + Claude Code agent) concurrently. Open [http://localhost:5173](http://localhost:5173) in your browser.

### Why do you need a Gemini API key?

MulmoClaude uses Google's **Gemini 3.1 Flash Image (nano banana 2)** model for image generation and editing. This powers:

- `generateImage` — creates images from text descriptions
- `editImage` — transforms or modifies an existing image (e.g. "convert to Ghibli style")
- Inline images embedded in documents (Recipe Guide, Trip Planner, etc.)

Without a Gemini API key, roles that use image generation will be disabled in the UI.

### Getting a Gemini API key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Sign in with your Google account
3. Click **Create API key**
4. Copy the key and paste it into your `.env` file as `GEMINI_API_KEY=...`

The Gemini API has a free tier that is sufficient for personal use.

## Calendar Import (iCal)

MulmoClaude can import events from Google Calendar, Outlook, and other services that provide iCal URLs. See [docs/ical-setup.md](docs/ical-setup.md) for setup instructions.

## Workspace

All data is stored as plain files in the workspace directory:

```
~/mulmoclaude/
  chat/        ← conversation history (one .jsonl per session)
  todos/        ← todo items
  memory.md     ← persistent facts Claude always has in context
  ...
```