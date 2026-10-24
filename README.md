# LinkedIn Post Checker

Capture LinkedIn posts with a Chrome extension, search them by keyword, and export emails, companies and technologies to Excel.

## Run the portal

```bash
npm install
npm run dev        # http://localhost:3001
```

Posts are stored in `data/posts.json` locally, or in Upstash Redis when deployed (see **Deploy on Vercel**).

## Install the extension

1. Open `chrome://extensions`, enable **Developer mode**.
2. Click **Load unpacked** and pick the `extension/` folder.

## Use it

**Automatic search:** click the extension icon, enter keywords (one search per line), pick **Date posted** and **Sort by**, and click **Search & capture all**. The extension opens each LinkedIn search with those filters, captures the posts, and sends them to the portal, pausing between searches. The run continues in the background if you close the popup; reopen it to see progress or press **Stop**.

**Current page:** if you've already searched on LinkedIn yourself, click **Capture this page**.

Scroll depth, post links, and the portal URL are under **Settings** in the popup.

In the portal, search, tick **Only posts with emails** if you want, and click **Export to Excel**. The file has two sheets: **Posts** (one row per post) and **Contacts** (one row per unique email).

## Email HRs

Click **Send ✉** next to an email to review and send one application, or **Email all unsent** to review and send to every email in the current search. Emails go out from your Gmail (`EMAIL_USER` / `EMAIL_PASS`, a Gmail app password) with your resume attached.

For each email the portal:
- builds the subject from the post (`Application for <role> [at <company>] | <years> Experience | Immediate Joiner`), or uses the exact subject the post asks for ("Subject line: …");
- picks the template and resume: 2.5 yrs when the post asks for under 3 years, otherwise 3.5 yrs (`resumes/`, templates in `lib/sendmail.ts`);
- names the role and company in the email and adds a line about the skills you have that the post asks for;
- names the company only when the post text and the email domain agree, otherwise "your company";
- remembers sent emails and won't email the same address twice unless you choose **Send again**.

Bulk sends pause 2 seconds between emails. Gmail allows about 500 emails/day; staying well under that avoids spam folders.

## Deploy on Vercel

1. **Make the GitHub repo private** — it contains your resumes and contact details.
2. Vercel → your project → **Storage** → **Upstash for Redis** → create a free database and connect it to the project. This adds `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_*`) automatically. Without it, posts aren't saved on Vercel.
3. Vercel → **Settings → Environment Variables**: add `PORTAL_PASSWORD`, `EMAIL_USER`, `EMAIL_PASS` (see `.env.example`).
4. Redeploy (Deployments → ⋯ → Redeploy) so the new variables take effect.
5. In the extension popup → **Settings**: set **Portal URL** to your Vercel address and **Portal password** to `PORTAL_PASSWORD`. Chrome asks to allow the site on the first capture.

Locally nothing changes: without these variables there's no login and posts are saved in `data/`.

## Notes

- Company and technology extraction is heuristic (pattern matching plus a tech dictionary in `lib/extract.ts`). Add terms to `TECHNOLOGIES` as needed.
- LinkedIn changes its page markup from time to time. If capture finds 0 posts, update the selectors in `scrapeLinkedInPosts` in `extension/capture.js`.
- Automated collection from LinkedIn is against their User Agreement. Keep the volume modest (5–10 keywords per run, 15s+ pause) to avoid account restrictions.
