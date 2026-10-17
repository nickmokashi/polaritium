# Setting up the optional AI

Polaritium works fully without AI. This page is only for adding your own Claude key.

## What you need

An Anthropic Console account with billing set up: https://platform.claude.com (the game's
**Open the Anthropic Console** button goes there).

## Recommended setup (about five minutes)

1. In the Console, make a new **workspace** named `Polaritium`.
2. Give that workspace a **monthly spend limit of $10**. This is a second lock, on Anthropic's
   side: even if something went wrong in the game, Anthropic would stop it at that limit.
3. Make an **API key inside that workspace**. Copy it (it begins `sk-ant-`).
4. In Polaritium: **Settings, AI**. Paste the key and press **Save key**.
5. Press **Check the key (free)**. It asks Anthropic which models the key may use; it uses no
   tokens and costs nothing.
6. Switch **AI is on**.

If you later raise the game's allowance, raise the workspace limit too. Whichever is lower is
the one that applies.

## Where the key goes

The key is stored in your Windows user profile, encrypted by Windows (DPAPI, through Electron's
`safeStorage`). The game page never receives it, never shows it again, and it is never written
into saves, exports, pictures, logs or diagnostics. **Remove the key** deletes it.

## Which models

- **Claude Haiku 5.5** for everything, by default. A typical request costs well under a tenth
  of a cent.
- **Claude Sonnet 5.5** only for a **Deeper reading** you ask for, and only after you allow it
  in Settings, AI budget. About twenty times the cost of Haiku.
- Opus, Fable and other premium models are never used.

## If it does not work

| The game says | What to do |
|---|---|
| Save a Claude key first | Paste and save a key in Settings, AI. |
| The key was refused | Make a new key in the Console and save it again. |
| Could not reach Anthropic | Check the internet connection. The game keeps working offline. |
| The monthly allowance is used up | Wait for the reset (shown in Settings, AI budget) or raise it there. |
| AI is not available in this copy | Only the browser test version shows this. The installed game has AI. |

Every refusal is free: the game decides before anything is sent.
