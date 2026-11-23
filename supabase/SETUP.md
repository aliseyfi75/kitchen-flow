# KitchenFlow — Phase 2 Cloud Setup Guide (~5 Minutes, $0/month)

This guide connects your **public GitHub Pages** app to your **private 2-user Supabase backend** and **server-side Gemini AI Edge Function** (no credit card required).

---

## Step 1: Create a Free Supabase Project (2 min)
1. Go to https://supabase.com and sign in (GitHub sign-in works).
2. Click **New Project** → pick a name (e.g. `kitchen-flow`), choose a strong DB password, pick the region closest to you, and create it (Free Tier).
3. Once ready, go to **Project Settings → API** and copy:
   - **Project URL** (`https://xxxxx.supabase.co`)
   - **anon / public key** (safe for frontend — Row Level Security protects all data)

## Step 2: Create the Database Tables & Lock Down RLS (1 min)
1. In Supabase Dashboard, open **SQL Editor → New Query**.
2. Paste the entire contents of `supabase/schema.sql` and click **Run**.

## Step 3: Create Strictly 2 Private Accounts (You & Your Wife) (1 min)
1. Go to **Authentication → Providers → Email** and turn **OFF** **"Enable sign ups"** (or turn on Invite-only / disable new user signups in **Authentication → Sign In / Providers → User Signups**).
   - Now **nobody on the internet can sign up**!
2. Go to **Authentication → Users → Add user → Create new user**:
   - Create Account 1 (your email + password, check **Auto Confirm User**).
   - Create Account 2 (your wife's email + password, check **Auto Confirm User**).
3. Go back to **SQL Editor**, uncomment the bottom `do $$ ... end $$;` block from `supabase/schema.sql`, replace the two placeholder emails with your and your wife's emails, and click **Run**.
   - Now Row Level Security locks every single row exclusively to those two users!

## Step 4: Connect GitHub Pages (1 min)
1. On your GitHub repo (`https://github.com/aliseyfi75/kitchen-flow`):
   - Go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
   - Go to **Settings → Secrets and variables → Actions → Variables** (or **Secrets**) and add:
     - `VITE_SUPABASE_URL` = your Supabase Project URL
     - `VITE_SUPABASE_ANON_KEY` = your Supabase `anon` public key
2. Re-run the latest GitHub Actions workflow (or push any commit) → your live app is up at:
   **https://aliseyfi75.github.io/kitchen-flow/**
3. On both your phone and your wife's phone, open the link → tap **Share → Add to Home Screen** (iOS) or **Install App** (Android) → sign in once!

## Step 5 (Optional / Anytime): Enable Live Gemini AI Edge Function
To power real AI meal suggestions, live photo receipt parsing, and nutrition label photo scanning without EVER exposing your Gemini API key:
```bash
# Install Supabase CLI (once): brew install supabase/tap/supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set GEMINI_API_KEY=your_google_ai_studio_key
supabase functions deploy gemini-assistant
```
Your `GEMINI_API_KEY` stays encrypted inside Supabase and is only callable by your two logged-in household accounts.
