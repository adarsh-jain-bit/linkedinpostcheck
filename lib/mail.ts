import type { Post } from "./store";
import { extractCompanies, extractExperience, formatExperience } from "./extract";

// Experience levels; each has its own template + resume (see sendmail.ts)
export const EXPERIENCE_LEVELS = {
  "2yr5mon": { label: "2.5 yrs", subjectLabel: "2.5+ Years" },
  "3years": { label: "3.5 yrs", subjectLabel: "3.5+ Years" },
} as const;
export type ExperienceLevel = keyof typeof EXPERIENCE_LEVELS;

// Skills named in the email templates (keep in sync with MY_SKILLS in sendmail.ts)
const MY_SKILLS = new Set(
  ["JavaScript", "TypeScript", "React", "Next.js", "Node.js", "Express", "MongoDB", "MySQL", "Redux", "AWS", "REST", "HTML", "CSS", "Tailwind", "Git"].map((s) => s.toLowerCase())
);

export function matchingSkills(technologies: string[]): string[] {
  return technologies.filter((t) => MY_SKILLS.has(t.toLowerCase()));
}

// Posts asking for under 3 years get the 2.5-year resume; 3+ or unstated gets the 3.5-year one
export function chooseExperienceLevel(text: string): ExperienceLevel {
  const exp = extractExperience(text);
  if (exp && exp.min < 3) return "2yr5mon";
  return "3years";
}

// Recruiters often say: Subject line: "React Developer - Indore"
const REQUESTED_SUBJECT_RE =
  /(?:subject(?:\s*line)?|mail\s+subject)\s*(?:should\s+be|as|:|-|–)\s*[:\-–]?\s*["“'‘]?([^"”'’\n]{5,120})["”'’]?/i;

export function requestedSubject(text: string): string | null {
  const m = text.match(REQUESTED_SUBJECT_RE);
  return m ? m[1].trim().replace(/[.,;]+$/, "") : null;
}

function titleCase(s: string) {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

const ROLE_NOUN_RE = /\b(developer|engineer|programmer|designer|architect|analyst|lead|intern|consultant|specialist|tester|sde|devops)\b/i;
const KEEP_UPPER = new Set(["JS", "UI", "UX", "QA", "SDE", "MERN", "MEAN", "AWS", "API", "SR", "JR", "IT", "AI", "ML"]);

// "MERN Stack Developers" -> "MERN Stack Developer", "REACT JS DEVELOPER" -> "React JS Developer",
// "React JS" -> "React JS Developer"
export function primaryRole(post: Pick<Post, "roles">): string {
  let role = (post.roles[0] || "").trim();
  if (!role) return "React.js Developer";
  role = role.replace(/(er|or|ist|ect|ant|ate|ive|ead)s$/i, "$1");
  if (role === role.toUpperCase() || role === role.toLowerCase()) {
    role = role
      .split(/\s+/)
      .map((w) => (KEEP_UPPER.has(w.toUpperCase().replace(/\.$/, "")) ? w.toUpperCase() : titleCase(w.toLowerCase())))
      .join(" ");
  }
  if (!ROLE_NOUN_RE.test(role)) role += " Developer";
  return role;
}

// Only name the company when the post text and the HR's email domain agree
// ("TechNova Solutions" + jobs@technova.io). A wrong company name in an application
// reads worse than "your company", so anything uncertain is left blank.
export function companyFor(post: Pick<Post, "text" | "authorHeadline">, email: string): string {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  const label = domain.split(".")[0];
  if (!label || label.length < 3) return "";
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const match =
    extractCompanies(post.text, [], post.authorHeadline).find((c) => {
      const sq = squash(c);
      return sq.length >= 3 && (sq.startsWith(label) || label.startsWith(sq));
    }) ?? "";
  // "Trimus HR Solutions Private" (from "... Private Limited") -> "Trimus HR Solutions"
  return match.replace(/\s+(private|pvt\.?|ltd\.?|limited|llp|inc\.?)(\s.*)?$/i, "").trim();
}

export function experienceAsked(text: string): string {
  return formatExperience(extractExperience(text));
}

export function buildSubject(
  post: Pick<Post, "text" | "roles">,
  level: ExperienceLevel,
  { role = primaryRole(post), company = "" } = {}
): string {
  const asked = requestedSubject(post.text);
  if (asked) return asked;
  const at = company ? ` at ${company}` : "";
  return `Application for ${role}${at} | ${EXPERIENCE_LEVELS[level].subjectLabel} Experience | Immediate Joiner`;
}

export type Draft = {
  email: string;
  subject: string;
  experienceLevel: ExperienceLevel;
  role: string;
  company: string;
  skills: string[];
  experienceAsked: string; // shown in the UI only, e.g. "4-6 yrs"
};

export function draftFor(post: Post, email: string): Draft {
  const experienceLevel = chooseExperienceLevel(post.text);
  const role = primaryRole(post);
  const company = companyFor(post, email);
  return {
    email,
    experienceLevel,
    role,
    company,
    skills: post.technologies,
    experienceAsked: experienceAsked(post.text),
    subject: buildSubject(post, experienceLevel, { role, company }),
  };
}
