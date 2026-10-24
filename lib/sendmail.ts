import path from "path";
import nodemailer from "nodemailer";
import type { Draft, ExperienceLevel } from "./mail";

// Email sending, moved here from the mail sender project so one app does everything.
// Templates are copied word for word from emailsender/mailsender/app/api/send-mail/route.js.

// Resume attached for each experience level (files live in ./resumes, not public)
const RESUMES: Record<ExperienceLevel, string> = {
  "2yr5mon": "resume2.5yr.pdf",
  "3years": "resume3yr.pdf",
};
const RESUME_FILENAME = "Aadarsh_Jain_Resume.pdf";
const FROM_NAME = process.env.MAIL_FROM_NAME || "Aadarsh Jain";

// Skills named in the templates; a post's technologies are matched against these
const MY_SKILLS = [
  "JavaScript", "TypeScript", "React", "React.js", "Next.js", "Node.js", "Express", "Express.js",
  "MongoDB", "MySQL", "Redux", "AWS", "REST", "HTML", "CSS", "Tailwind", "Git", "MERN",
];

const TEMPLATES: Record<ExperienceLevel, string> = {
  "2yr5mon": `<p>Dear Sir/Ma'am,</p>

<p>
  I am writing to express my interest in the <b>React.js Developer</b> role at your company.
  I have <b>2.5+ years of professional experience</b> in software development, building
  scalable web applications using <b>JavaScript, React.js, Next.js, and Node.js</b>.
</p>

<p>
  <b>Current:</b> Full Stack Developer (MERN) at BestPeers InfoSystem (Client-Based)<br/>
  <b>Previous:</b> MERN Stack Developer at ScaleUs Technologies<br/>
  <b>Previous:</b> MERN Stack Developer at Impulse Websystem<br/>
  <b>Internship:</b> MERN Stack Developer Intern at Amenses Innovation (1 year)
</p>

<p>
  I have hands-on experience developing reusable React components, integrating REST APIs,
  managing application state, optimizing performance, and building responsive web applications.
  I have also worked with <b>Node.js, Express.js, MongoDB, MySQL, Redux, TypeScript, and AWS</b>
  across multiple production projects.
</p>

<p>
  <b>✅ I am available to join immediately and open to relocation.</b>
</p>

<p>
  Please find my resume attached. You can also view my portfolio here:
  <a href="https://portfolio-website-one-rho-18.vercel.app/" target="_blank">Portfolio</a>
</p>

<p>Looking forward to your response.</p>

<p>
  Best regards,<br/>
  <b>Aadarsh Jain</b><br/>
  📞 9926924500<br/>
  📧 <a href="mailto:adarshj0304@gmail.com">adarshj0304@gmail.com</a>
</p>

<p>
  🔗
  <a href="https://www.linkedin.com/in/aadarsh-jain-574b3621b/" target="_blank">LinkedIn</a> |
  <a href="https://github.com/adarsh-jain-bit" target="_blank">GitHub</a> |
  <a href="https://portfolio-website-one-rho-18.vercel.app/" target="_blank">Portfolio</a>
</p>`,

  "3years": `<p>Dear Sir/Ma'am,</p>

<p>
  I am writing to express my interest in the <b>React.js Developer</b> role at your company.
  I have <b>3.5+ years of total experience, including 1 year of internship experience</b>,
  building scalable web applications using <b>JavaScript, React.js, Next.js, and Node.js</b>.
</p>

<p>
  <b>Current:</b> Full Stack Developer (MERN) at BestPeers InfoSystem (Client-Based)<br/>
  <b>Previous:</b> MERN Stack Developer at ScaleUs Technologies<br/>
  <b>Previous:</b> MERN Stack Developer at Impulse Websystem<br/>
  <b>Internship:</b> MERN Stack Developer Intern at Amenses Innovation (1 year)
</p>

<p>
  I have strong hands-on experience in building reusable React components, developing
  full-stack applications, integrating REST APIs, implementing state management, optimizing
  application performance, and deploying applications on <b>AWS</b>. I have worked extensively
  with <b>React.js, Next.js, TypeScript, Node.js, Express.js, MongoDB, MySQL, Redux, and REST APIs</b>
  across production applications and client projects.
</p>

<p>
  <b>✅ I am available to join immediately and open to relocation.</b>
</p>

<p>
  Please find my resume attached. You can also view my portfolio here:
  <a href="https://portfolio-website-one-rho-18.vercel.app/" target="_blank">Portfolio</a>
</p>

<p>Looking forward to your response.</p>

<p>
  Best regards,<br/>
  <b>Aadarsh Jain</b><br/>
  📞 9926924500<br/>
  📧 <a href="mailto:adarshj0304@gmail.com">adarshj0304@gmail.com</a>
</p>

<p>
  🔗
  <a href="https://www.linkedin.com/in/aadarsh-jain-574b3621b/" target="_blank">LinkedIn</a> |
  <a href="https://github.com/adarsh-jain-bit" target="_blank">GitHub</a> |
  <a href="https://portfolio-website-one-rho-18.vercel.app/" target="_blank">Portfolio</a>
</p>`,
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Puts the post's role, company and matching skills into the template
export function renderEmail({ experienceLevel, role, company, skills }: Pick<Draft, "experienceLevel" | "role" | "company" | "skills">) {
  const roleHtml = `<b>${escapeHtml(role || "React.js Developer")}</b>`;
  const companyHtml = company ? `<b>${escapeHtml(company)}</b>` : "your company";
  let html = TEMPLATES[experienceLevel].replace(
    "the <b>React.js Developer</b> role at your company",
    `the ${roleHtml} role at ${companyHtml}`
  );
  const mine = new Set(MY_SKILLS.map((s) => s.toLowerCase()));
  const matching = [...new Set(skills.filter((s) => mine.has(s.toLowerCase())))];
  if (matching.length) {
    const list = matching.map((s) => `<b>${escapeHtml(s)}</b>`).join(", ");
    html = html.replace(
      "<p>\n  <b>✅ I am available",
      `<p>\n  Your requirement for ${list} closely matches my day-to-day work, and I can contribute from day one.\n</p>\n\n<p>\n  <b>✅ I am available`
    );
  }
  return html;
}

let transporter: nodemailer.Transporter | null = null;

export async function sendApplication(draft: Draft) {
  const { EMAIL_USER, EMAIL_PASS } = process.env;
  if (!EMAIL_USER || !EMAIL_PASS) {
    throw new Error("Gmail is not set up: add EMAIL_USER and EMAIL_PASS (a Gmail app password) to the environment.");
  }
  transporter ??= nodemailer.createTransport({ service: "gmail", auth: { user: EMAIL_USER, pass: EMAIL_PASS } });
  await transporter.sendMail({
    from: `${FROM_NAME} <${EMAIL_USER}>`,
    to: draft.email,
    subject: draft.subject,
    html: renderEmail(draft),
    attachments: [{ filename: RESUME_FILENAME, path: path.join(process.cwd(), "resumes", RESUMES[draft.experienceLevel]) }],
  });
}
