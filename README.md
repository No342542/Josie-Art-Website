# Josie — Gallery Website

A simple, self-contained portfolio site. **No build step, no accounts.**

## Manage the gallery — the easy way

In the main **Art Gallery Website** folder, **double-click `Manage Josie.command`**.
A small Terminal window opens and your browser shows a visual manager — your
photos as cards. No coding, everything saves automatically:

- **Add photos** — **drag image files from Finder onto the page** (drop them
  anywhere), or press **＋ Add photos**. New photos appear as cards.
- **Edit** — **click a photo** to open its panel: title, date, **category bucket**
  (Featured / Full / Sketch), and a comment. Download it from there too.
- **Add a speed-paint** — in a photo's panel, click **Add…** next to *Speed-paint video*
  and choose its **.mp4** (export from Procreate). It appears under that photo and
  **loops until Stop** — just Play/Stop, no progress bar. Use **Remove** to clear it.
- **Reorder** — **drag a card** to a new spot; the gallery shows them in that order.
- **Remove** — **drag a card onto the trash can** (bottom-right), or open a photo and
  press **Move to Trash**.
- **Undo a deletion** — open **🗑 Trash**: removed photos stay there for **30 days**.
  Press **Restore** to bring one back, or **Delete now** to remove it for good.
- **⚙ About** — edit the About text and Instagram link.
- **🌐 Publish** — when you're happy, click Publish to push your changes live (the website updates in about a minute).
- **Preview ↗** shows your draft before publishing. Close the Terminal window when you're done.

**First time only:** macOS may say the `.command` is from an unidentified
developer — **right-click it → Open → Open**. It needs **Python 3** (already on
most Macs; if missing, macOS will offer to install it the first time).

## Replace the logo photo
Swap `assets/img/logo/josie-icon.jpg` with your own square-ish photo (same
filename). It's automatically cropped into the circle (no text on Josie's).

## Where you work (no Tailscale, no shared computer)
Run the Manage tool **on your own Mac**, on your own copy of this `Josie` folder.
The address `http://127.0.0.1:8091/admin/` just means *this computer*, so there's
nothing to connect to and nothing to expose to the network. Ann and Josie each
manage their own site on their own laptop, independently.

## Publishing — making changes live
Your edits save to your own computer instantly. When you're ready for the public
site to update, click **🌐 Publish** — it sends your changes to GitHub and your
live website refreshes in about a minute.

## One-time setup (a tech-comfortable person does this once per site)
Connects the site to GitHub + your Squarespace domain:
1. **GitHub repo** — create a repo for this site and push this `Josie` folder into it
   (or `git clone` the empty repo and move the files in). The Publish button then
   runs `git push` for you.
2. **GitHub Pages** — repo → Settings → Pages → deploy from the `main` branch. You
   get a free `https://<user>.github.io/<repo>/` URL.
3. **Squarespace domain** — in Squarespace's DNS settings add the records GitHub
   Pages lists (A records / a CNAME), then set the custom domain in repo → Pages.
4. **Each artist's Mac** — put a `git clone` of the repo there, and sign in to GitHub
   once so pushing works (easiest: install the GitHub CLI and run `gh auth login`).
   After that, **Publish** just works — no terminal, no GitHub knowledge needed.

This site is fully independent from Ann's — its own repo, its own domain.

---
*Advanced:* all content lives in `assets/js/data.js` (the Manage tool reads and
writes it). You can hand-edit that file too, but keep it valid JSON.
