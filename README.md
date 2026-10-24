# LinkedIn Post Checker

Capture LinkedIn posts with a Chrome extension, search them by keyword, and export emails, companies and technologies to Excel.

## Run the portal

```bash
npm install
npm run dev        # http://localhost:3001
```

Posts are stored in `data/posts.json`. Set `INGEST_TOKEN` (see `.env.example`) if the portal is reachable by others.

## Install the extension

1. Open `chrome://extensions`, enable **Developer mode**.
2. Click **Load unpacked** and pick the `extension/` folder.

## Use it

**Automatic search:** click the extension icon, enter keywords (one search per line), pick **Date posted** and **Sort by**, and click **Search & capture all**. The extension opens each LinkedIn search with those filters, captures the posts, and sends them to the portal, pausing between searches. The run continues in the background if you close the popup; reopen it to see progress or press **Stop**.

**Current page:** if you've already searched on LinkedIn yourself, click **Capture this page**.

Scroll depth, post links, and the portal URL are under **Settings** in the popup.

In the portal, search, tick **Only posts with emails** if you want, and click **Export to Excel**. The file has two sheets: **Posts** (one row per post) and **Contacts** (one row per unique email).

## Email HRs (mail sender integration)

The portal sends applications through the mail sender project (`../emailsender/mailsender`), which holds the email templates, resumes and Gmail login.

1. In the mail sender folder, make sure `.env.local` has `EMAIL_USER` and `EMAIL_PASS` (a Gmail app password), then run `npm run dev` (port 3002).
2. In the portal, click **Send ✉** next to an email to review and send one application, or **Email all unsent** to review and send to every email in the current search.

For each email the portal:
- builds the subject from the post (`Application for <role> [at <company>] | <years> Experience | Immediate Joiner`), or uses the exact subject the post asks for ("Subject line: …");
- picks the resume: 2.5 yrs when the post asks for under 3 years, otherwise 3.5 yrs;
- passes the role, company and the post's technologies to the template, which names the role and company and adds a line about the skills you have that the post asks for;
- names the company only when the post text and the email domain agree, otherwise "your company";
- remembers sent emails (`data/sent.json`) and won't email the same address twice unless you choose **Send again**.

Bulk sends pause 2 seconds between emails. Gmail allows about 500 emails/day; staying well under that avoids spam folders.

## Notes

- Company and technology extraction is heuristic (pattern matching plus a tech dictionary in `lib/extract.ts`). Add terms to `TECHNOLOGIES` as needed.
- LinkedIn changes its page markup from time to time. If capture finds 0 posts, update the selectors in `scrapeLinkedInPosts` in `extension/capture.js`.
- Automated collection from LinkedIn is against their User Agreement. Keep the volume modest (5–10 keywords per run, 15s+ pause) to avoid account restrictions.
