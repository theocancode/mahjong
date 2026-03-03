# 🀄 Deploying Your Family Mahjong Game to mahjong.cdmine.me
### No coding experience needed — follow these steps one by one.

---

## What You Have

Inside the `mahjong/` folder you downloaded:
```
mahjong/
├── server.js          ← The game brain (runs on the server)
├── package.json       ← Tells the server what it needs
└── public/
    └── index.html     ← The game interface everyone plays in their browser
```

---

## Step 1 — Create a Free Railway Account

1. Go to **https://railway.app**
2. Click **"Start a New Project"** and sign up with your GitHub account
   - If you don't have GitHub: go to **https://github.com** and create a free account first (takes 2 minutes)

---

## Step 2 — Upload Your Game to GitHub

1. Go to **https://github.com/new**
2. Repository name: `mahjong-cdmine` (or anything you like)
3. Set it to **Private**
4. Click **"Create repository"**
5. On the next page, click **"uploading an existing file"**
6. Upload these files:
   - `server.js`
   - `package.json`
   - The entire `public/` folder (drag and drop it)
7. Click **"Commit changes"**

---

## Step 3 — Deploy on Railway

1. Go to **https://railway.app/dashboard**
2. Click **"New Project"** → **"Deploy from GitHub repo"**
3. Select your `mahjong-cdmine` repository
4. Railway will automatically detect it's a Node.js app and deploy it
5. Wait about 60 seconds — a green checkmark will appear
6. Click on your deployment → **"Settings"** → **"Networking"** → click **"Generate Domain"**
   - This gives you a URL like `mahjong-cdmine.up.railway.app`
   - Test it first — you should see the game login screen!

---

## Step 4 — Point mahjong.cdmine.me to Your Game

This part happens in your domain registrar (wherever you manage cdmine.me — likely Namecheap, GoDaddy, or Cloudflare).

1. Log into your domain registrar
2. Go to **DNS settings** for cdmine.me
3. Add a new **CNAME record**:
   - **Name / Host:** `mahjong`
   - **Value / Target:** your Railway URL (e.g. `mahjong-cdmine.up.railway.app`)
   - **TTL:** Auto or 3600
4. Save it
5. In Railway → Settings → Networking → **"Add Custom Domain"**
   - Type: `mahjong.cdmine.me`
   - Railway will handle the SSL certificate automatically

DNS changes take 5–30 minutes to kick in.

---

## Step 5 — Play!

Share **https://mahjong.cdmine.me** with your family.

### How to start a game:
1. **You** open the link, enter your name, click **"Create Room"**
2. A **4-letter room code** appears (e.g. `A7BX`)
3. Share that code with family — they go to the same URL, enter their name, click **"Join Room"**, and type the code
4. Once everyone (2–4 players) has joined, the **host clicks "Start Game"**
5. The game begins automatically!

### Game rules summary:
- Everyone starts with **$10**
- **$1 ante** is collected at the start of each round into a pot
- The winner of each round **takes the full pot**
- If the wall runs out with no winner, the pot is split equally
- Rounds auto-continue — the dealer rotates each round

---

## Keeping It Running (Free Tier)

Railway's free tier gives you **$5/month of credit** which easily covers this game for family use (it uses very little compute). Your game will stay up as long as you have credit.

If you want it to stay up permanently for cheap: Railway Hobby plan is **$5/month** — worth it if you play often.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| White screen / can't connect | Wait 2 minutes and refresh; Railway may still be deploying |
| Room code doesn't work | Make sure everyone is on the same URL (mahjong.cdmine.me) |
| Player disconnects mid-game | They can rejoin with the same name and room code |
| "Room not found" error | The server may have restarted; create a new room |

---

## Questions?

The game file is fully self-contained. If you want to change anything (starting balance, ante amount, timer duration), those settings are clearly labeled near the top of `server.js`.
