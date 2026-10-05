# My Time Planner

A personal planner where you talk to an AI assistant to capture tasks. It includes a month calendar, alarms, and a Pending / Started / Ongoing / Completed board. Sign-in uses Google, and only your email can get in.

**How it's secured**

- **Google login** runs through Supabase Auth.
- **Allowlist in the database.** A database trigger rejects sign-up from any Google account not in `allowed_users`.
- **Row-level security.** Every task row is readable and writable only by its owner, and only if that owner is on the allowlist. This is enforced by Postgres itself, not by the page.
- **AI key stays on the server.** The Anthropic API key lives only in Vercel's environment. `/api/assistant` checks your login token and your email before every call. It reads your tasks *with your own token*, so the same database rules apply.
- **Strict security headers.** These are set in `vercel.json`: CSP, no framing, and HSTS.

## Setup (about 15 minutes)

### 1. Supabase: database
1. Create a project at supabase.com. Pick a region near you, such as Singapore.
2. Open `supabase/schema.sql`. Replace `you@gmail.com` with your Google email.
3. Paste the whole file into **SQL Editor** and click **Run**.
4. Go to **Project Settings → API**. Copy the **Project URL** and the **anon public** key.

### 2. Google: sign-in credentials
1. Go to console.cloud.google.com and create a project (or reuse one).
2. Open **APIs & Services → OAuth consent screen**. Choose External, fill in the app name and your email, and add your email as a test user.
3. Open **Credentials → Create credentials → OAuth client ID → Web application**.
   - Under **Authorized redirect URIs**, add `https://YOUR-PROJECT.supabase.co/auth/v1/callback`. You can copy the exact URL from Supabase under **Authentication → Providers → Google**.
4. Copy the **Client ID** and **Client secret**.

### 3. Supabase: turn on Google
1. Open **Authentication → Providers → Google**. Enable it and paste the Client ID and secret.
2. Open **Authentication → URL Configuration**.
   - Set **Site URL** to your Vercel URL (you'll get it in step 4; you can come back and update it).
   - Under **Redirect URLs**, add your Vercel URL, plus `http://localhost:3000` if you'll test locally.

### 4. Vercel: deploy
1. Push this folder to a private GitHub repo. In Vercel, click **Add New → Project** and import it. The framework preset is **Other**, and no build command is needed.
2. Under **Settings → Environment Variables**, add:

| Name | Value |
|---|---|
| `SUPABASE_URL` | your Supabase project URL |
| `SUPABASE_ANON_KEY` | your Supabase anon public key |
| `ANTHROPIC_API_KEY` | from console.anthropic.com |
| `ALLOWED_EMAIL` | your Google email (comma-separate to add more later) |
| `ANTHROPIC_MODEL` | optional, defaults to `claude-haiku-4-5-20251001` |

3. Deploy. Then put the final URL into Supabase's Site URL and Redirect URLs (step 3.2).

You can deploy from the terminal instead: run `npm i -g vercel`, then `vercel`, then `vercel --prod`.

### 5. Use it
Open the URL and sign in with Google. On your phone, choose **Add to Home Screen** so it opens like an app.

## Adding someone later
Do both of these:
- Run `insert into public.allowed_users (email) values ('them@gmail.com');` in the SQL editor.
- Add their email to `ALLOWED_EMAIL` in Vercel.

Each person only ever sees their own tasks.

## Files
- `public/index.html` is the whole app: UI, login, calendar, board, alarms.
- `api/assistant.js` is the AI assistant (server-side).
- `api/config.js` gives the browser the public Supabase settings.
- `supabase/schema.sql` sets up the tables, allowlist, security rules, and live sync.
- `vercel.json` holds the hosting config and security headers.

## Known limits
- Alarms ring only while the app is open. For alarms when it's closed, tap "Add to Google Calendar" on a task. Push notifications can be added later with a Supabase scheduled job.
- The AI rate limit (20 requests a minute) is per server instance. That's fine for one person.
