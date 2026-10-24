import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { searchOptionsFrom, searchPosts } from "@/lib/store";
import { formatExperience } from "@/lib/extract";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const posts = await searchPosts(q, searchOptionsFrom(req.nextUrl.searchParams));

  const wb = new ExcelJS.Workbook();

  const sheet = wb.addWorksheet("Posts");
  sheet.columns = [
    { header: "Author", key: "author", width: 24 },
    { header: "Author Headline", key: "authorHeadline", width: 36 },
    { header: "Author Profile", key: "authorUrl", width: 40 },
    { header: "Role", key: "roles", width: 30 },
    { header: "Experience", key: "experience", width: 12 },
    { header: "Company", key: "companies", width: 28 },
    { header: "Emails", key: "emails", width: 32 },
    { header: "Technologies", key: "technologies", width: 40 },
    { header: "Posted", key: "postedAt", width: 10 },
    { header: "Captured", key: "capturedAt", width: 20 },
    { header: "Post URL", key: "url", width: 40 },
    { header: "Post Text", key: "text", width: 80 },
  ];
  for (const p of posts) {
    const row = sheet.addRow({
      ...p,
      roles: p.roles.join(", "),
      experience: formatExperience(p.experience),
      companies: p.companies.join(", "),
      emails: p.emails.join(", "),
      technologies: p.technologies.join(", "),
      capturedAt: new Date(p.capturedAt).toLocaleString(),
      text: p.text.slice(0, 32000), // Excel cell limit is 32,767 chars
    });
    if (p.url) row.getCell("url").value = { text: p.url, hyperlink: p.url };
    if (p.authorUrl) row.getCell("authorUrl").value = { text: p.authorUrl, hyperlink: p.authorUrl };
    row.getCell("text").alignment = { wrapText: true, vertical: "top" };
  }

  // One row per email, handy for outreach
  const contacts = wb.addWorksheet("Contacts");
  contacts.columns = [
    { header: "Email", key: "email", width: 32 },
    { header: "Role", key: "role", width: 30 },
    { header: "Experience", key: "experience", width: 12 },
    { header: "Company", key: "company", width: 28 },
    { header: "Posted By", key: "author", width: 24 },
    { header: "Author Profile", key: "authorUrl", width: 40 },
    { header: "Technologies", key: "technologies", width: 40 },
    { header: "Post URL", key: "url", width: 40 },
  ];
  const seen = new Set<string>();
  for (const p of posts) {
    for (const email of p.emails) {
      if (seen.has(email)) continue;
      seen.add(email);
      contacts.addRow({
        email,
        role: p.roles.join(", "),
        experience: formatExperience(p.experience),
        company: p.companies.join(", "),
        author: p.author,
        authorUrl: p.authorUrl ? { text: p.authorUrl, hyperlink: p.authorUrl } : "",
        technologies: p.technologies.join(", "),
        url: p.url,
      });
    }
  }

  for (const ws of [sheet, contacts]) {
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
  }

  const buffer = await wb.xlsx.writeBuffer();
  const slug = (q || "all").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="linkedin-posts-${slug}.xlsx"`,
    },
  });
}
