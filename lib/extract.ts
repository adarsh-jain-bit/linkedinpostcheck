// Heuristic extraction of emails, company names and technologies from post text.

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Catches "name [at] domain [dot] com" / "name (at) domain (dot) com"
const OBFUSCATED_EMAIL_RE =
  /([A-Za-z0-9._%+-]+)\s*[\[(]\s*at\s*[\])]\s*([A-Za-z0-9-]+(?:\s*[\[(]\s*dot\s*[\])]\s*[A-Za-z0-9-]+)+)/gi;

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com", "icloud.com",
  "aol.com", "protonmail.com", "proton.me", "yahoo.co.in", "rediffmail.com", "zoho.com",
  "gmx.com", "mail.com", "yandex.com",
]);

export function extractEmails(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.match(EMAIL_RE) ?? []) {
    found.add(m.replace(/\.+$/, "").toLowerCase());
  }
  for (const m of text.matchAll(OBFUSCATED_EMAIL_RE)) {
    const domain = m[2].replace(/\s*[\[(]\s*dot\s*[\])]\s*/gi, ".");
    found.add(`${m[1]}@${domain}`.toLowerCase());
  }
  return [...found];
}

// Words that often follow "at"/"join" but are not companies
const COMPANY_STOPWORDS = new Set([
  "The", "A", "An", "Our", "My", "This", "That", "Us", "We", "You", "Your", "I", "It",
  "Least", "Once", "All", "Any", "Some", "Hand", "Home", "Work", "Office", "Remote",
  "LinkedIn", "Please", "Dm", "DM", "Apply", "Hiring", "Immediate", "Urgent", "Hi",
  "Hello", "Location", "Experience", "Role", "Position", "Job", "Jobs", "Team",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
]);

const COMPANY_WORD = "[A-Z][A-Za-z0-9&.'-]*";
// Words separated by spaces only, so names don't run onto the next line
const COMPANY_NAME = `(${COMPANY_WORD}(?:[ \\t]+(?:${COMPANY_WORD}|of|and|&)){0,3})`;

const COMPANY_PATTERNS: RegExp[] = [
  new RegExp(`(?:Company|Organization|Organisation|Client|Employer)\\s*[:\\-–]\\s*${COMPANY_NAME}`, "g"),
  new RegExp(`${COMPANY_NAME}\\s+(?:is|are)\\s+(?:hiring|looking for|seeking)`, "g"),
  new RegExp(`(?:hiring|openings?|opportunit(?:y|ies)|positions?|roles?|join(?:ing)?|work(?:ing)? with|at)\\s+(?:at\\s+)?${COMPANY_NAME}`, "g"),
  /(?:^|\s)@([A-Z][A-Za-z0-9&.-]{1,40})/g, // @Mentions
];

function cleanCompany(raw: string): string | null {
  // A name doesn't continue past a sentence end ("... Engineer. Mail")
  let name = raw.trim().split(/[.!?]\s/)[0].replace(/[.,;:!)'-]+$/, "");
  const words = name.split(/\s+/);
  while (words.length && COMPANY_STOPWORDS.has(words[0])) words.shift();
  while (words.length && /^(of|and|&)$/i.test(words[words.length - 1])) words.pop();
  name = words.join(" ");
  if (name.length < 2 || COMPANY_STOPWORDS.has(name)) return null;
  if (TECH_LOOKUP.has(name.toLowerCase())) return null;
  // "hiring React JS Developer" is a role, not a company
  if (new RegExp(`(?:^|\\s)(?:${ROLE_NOUNS})s?$`, "i").test(name)) return null;
  return name;
}

function companyFromDomain(email: string): string | null {
  const domain = email.split("@")[1];
  if (!domain || FREE_EMAIL_DOMAINS.has(domain)) return null;
  const parts = domain.split(".");
  // Use the label before the TLD (handles co.in / co.uk style domains)
  const label = parts.length > 2 && parts[parts.length - 2].length <= 3 ? parts[parts.length - 3] : parts[parts.length - 2];
  if (!label) return null;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function extractCompanies(text: string, emails: string[], authorHeadline = ""): string[] {
  const found = new Map<string, string>(); // lowercase -> display
  const add = (n: string | null) => {
    if (n && !found.has(n.toLowerCase())) found.set(n.toLowerCase(), n);
  };
  for (const re of COMPANY_PATTERNS) {
    for (const m of text.matchAll(re)) add(cleanCompany(m[1]));
  }
  for (const e of emails) {
    const fromDomain = companyFromDomain(e);
    // Skip "Technova" when "TechNova Solutions" was already found in the text
    if (fromDomain && ![...found.keys()].some((k) => k.replace(/\s+/g, "").startsWith(fromDomain.toLowerCase()))) {
      add(fromDomain);
    }
  }
  // Author headline like "Talent Acquisition at Infosys | ..."
  const hm = authorHeadline.match(new RegExp(`(?:at|@)\\s+${COMPANY_NAME}`));
  if (hm) add(cleanCompany(hm[1]));
  return [...found.values()];
}

// Display name -> extra aliases (all matched case-insensitively on word boundaries)
const TECHNOLOGIES: Record<string, string[]> = {
  JavaScript: ["js"], TypeScript: ["ts"], Python: [], Java: [], "C++": ["cpp"], "C#": ["csharp"],
  Go: ["golang"], Rust: [], Ruby: [], PHP: [], Kotlin: [], Swift: [], Scala: [], R: [],
  Dart: [], Perl: [], "Objective-C": [], Elixir: [], Haskell: [], Solidity: [], Bash: ["shell scripting"],
  React: ["react.js", "reactjs"], "Next.js": ["nextjs"], Angular: ["angularjs"], "Vue.js": ["vue", "vuejs"],
  Svelte: [], Redux: [], jQuery: [], HTML: ["html5"], CSS: ["css3"], Tailwind: ["tailwindcss", "tailwind css"],
  Bootstrap: [], SASS: ["scss"], "Node.js": ["node", "nodejs"], Express: ["express.js", "expressjs"],
  NestJS: ["nest.js"], Django: [], Flask: [], FastAPI: [], Spring: ["spring boot", "springboot"],
  Hibernate: [], ".NET": ["dotnet", "asp.net", ".net core"], Laravel: [], Rails: ["ruby on rails"],
  GraphQL: [], REST: ["rest api", "restful"], gRPC: [], Microservices: [],
  "React Native": [], Flutter: [], Android: [], iOS: [], Electron: [],
  SQL: [], MySQL: [], PostgreSQL: ["postgres"], MongoDB: ["mongo"], Redis: [], Oracle: [],
  "SQL Server": ["mssql"], SQLite: [], Cassandra: [], DynamoDB: [], Elasticsearch: ["elastic search"],
  Firebase: [], Supabase: [], Snowflake: [], BigQuery: [], Databricks: [], Kafka: [], RabbitMQ: [],
  Spark: ["pyspark", "apache spark"], Hadoop: [], Airflow: [], dbt: [], Tableau: [], "Power BI": ["powerbi"],
  Excel: [], ETL: [],
  AWS: ["amazon web services"], Azure: [], GCP: ["google cloud"], Docker: [], Kubernetes: ["k8s"],
  Terraform: [], Ansible: [], Jenkins: [], "GitHub Actions": [], GitLab: [], "CI/CD": ["cicd"],
  Linux: [], Git: [], Nginx: [], Serverless: [], Lambda: [], DevOps: [], SRE: [],
  "Machine Learning": ["ml"], "Deep Learning": [], AI: ["artificial intelligence"], "Generative AI": ["genai", "gen ai"],
  LLM: ["llms"], NLP: [], "Computer Vision": [], TensorFlow: [], PyTorch: [], "scikit-learn": ["sklearn"],
  Pandas: [], NumPy: [], LangChain: [], OpenAI: [], "Hugging Face": ["huggingface"], RAG: [],
  "Data Science": [], "Data Engineering": [], MLOps: [],
  Selenium: [], Cypress: [], Playwright: [], Jest: [], JUnit: [], Postman: [], Appium: [],
  Figma: [], Jira: [], Salesforce: [], SAP: [], ServiceNow: [], Workday: [], Shopify: [], WordPress: [],
  Blockchain: [], Web3: [], Unity: [], "Unreal Engine": [], Cybersecurity: ["cyber security"],
  "Agile": ["scrum"],
};

const CASE_SENSITIVE = new Set(["Go", "R", "AI", "ML", "ts", "js", "SQL", "REST", "Rust", "Swift", "Spring", "Express", "Spark", "Unity", "Lambda", "Node", "Oracle", "Excel"]);

const TECH_LOOKUP = new Map<string, string>();
const TECH_MATCHERS: { name: string; re: RegExp }[] = [];

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

for (const [name, aliases] of Object.entries(TECHNOLOGIES)) {
  for (const term of [name, ...aliases]) {
    TECH_LOOKUP.set(term.toLowerCase(), name);
    // Custom boundaries so "C++", "C#", ".NET", "Node.js" work
    // Short / ambiguous terms are case-sensitive and must not be hyphenated ("Go-getter")
    const strict = CASE_SENSITIVE.has(term);
    const after = strict ? "(?![A-Za-z0-9+#-]|\\.[A-Za-z])" : "(?![A-Za-z0-9+#]|\\.[A-Za-z])";
    TECH_MATCHERS.push({ name, re: new RegExp(`(?<![A-Za-z0-9+#.])${escapeRe(term)}${after}`, strict ? "" : "i") });
  }
}

export function extractTechnologies(text: string): string[] {
  const found = new Set<string>();
  for (const { name, re } of TECH_MATCHERS) {
    if (re.test(text)) found.add(name);
  }
  // "#reactjs" style hashtags
  for (const m of text.matchAll(/#([A-Za-z0-9+.]+)/g)) {
    const hit = TECH_LOOKUP.get(m[1].toLowerCase());
    if (hit) found.add(hit);
  }
  return [...found];
}

// "Role: React JS Developer", "Hiring - Sr. Frontend Engineer"
const LABELED_ROLE_RE =
  /(?:^|\n|\s)(?:job\s+)?(?:role|position|job title|title|designation|profile|opening|vacancy|now hiring|hiring|we'?re hiring|we are hiring)\s*(?:for)?\s*[:\-–]\s*([^\n|,;(]{3,70})/gi;

const ROLE_NOUNS =
  "developer|engineer|programmer|designer|architect|analyst|scientist|tester|manager|lead|intern|internship|consultant|administrator|admin|specialist|executive|associate|recruiter|trainee|officer|coordinator|head|director|strategist|writer|marketer|devops|sde|qa";

// Up to 4 qualifier words before a role noun: "Senior React.js Frontend Developer"
const ROLE_PHRASE_RE = new RegExp(`((?:[A-Za-z0-9.#+/-]+[ \\t]+){0,4}(?:${ROLE_NOUNS})s?)(?![A-Za-z])`, "gi");

const ROLE_LEADING_STOPWORDS = new Set([
  "a", "an", "the", "for", "we", "we're", "are", "is", "am", "hiring", "looking", "seeking", "need", "needed",
  "urgent", "urgently", "immediate", "immediately", "of", "in", "at", "with", "and", "or", "to", "our", "as",
  "join", "opening", "openings", "opportunity", "position", "role", "roles", "vacancy", "multiple", "two",
  "three", "few", "hi", "hello", "dear", "all", "my", "your", "this", "that", "who", "you", "if", "any",
  "years", "year", "yrs", "exp", "experience", "hire", "hires", "talented", "skilled", "passionate", "great",
  "strong", "experienced", "/", "-", "&",
]);

function cleanRole(raw: string): string | null {
  // Stop at emoji / symbols and at a following label ("… Location: Mumbai"); drop hashtags
  raw = raw.split(/[^A-Za-z0-9 .#+/&\-]/)[0].split(/\s+(?:location|experience|exp|salary|ctc|mode|type|notice)\b/i)[0];
  raw = raw.replace(/#/g, "");
  let words = raw.trim().replace(/[.:\-–]+$/, "").split(/\s+/);
  // Keep only the words after the last filler word: "TechNova for Node.js Developer" -> "Node.js Developer"
  const isFiller = (w: string) => ROLE_LEADING_STOPWORDS.has(w.toLowerCase()) || /^\d/.test(w);
  for (let i = words.length - 2; i >= 0; i--) {
    if (isFiller(words[i])) {
      words = words.slice(i + 1);
      break;
    }
  }
  const role = words.join(" ").trim();
  if (role.length < 2 || role.length > 70) return null;
  return role;
}

export function extractRoles(text: string): string[] {
  const found = new Map<string, string>(); // normalized -> display
  const add = (r: string | null) => {
    if (!r) return;
    const key = r.toLowerCase().replace(/\s+/g, " ").replace(/s$/, "");
    if (!found.has(key)) found.set(key, r);
  };
  for (const m of text.matchAll(LABELED_ROLE_RE)) add(cleanRole(m[1]));
  for (const m of text.matchAll(ROLE_PHRASE_RE)) add(cleanRole(m[1]));
  const roles = [...found.values()];
  // Prefer specific roles: drop bare "Developer" when "React Developer" exists, and phrases
  // that are contained in a longer role ("Frontend Developer" inside "Senior Frontend Developer")
  return roles.filter(
    (r) =>
      !(r.split(/\s+/).length === 1 && roles.some((o) => o.includes(" "))) &&
      !roles.some((o) => o !== r && o.toLowerCase().includes(r.toLowerCase()))
  );
}

export type Experience = { min: number; max: number | null }; // max null = "min+"

const NUM = "(\\d{1,2}(?:\\.\\d)?)";
const DASH = "\\s*(?:-|–|—|to)\\s*";
const UNIT = "\\s*\\+?\\s*(?:years?|yrs?)\\b";
const EXPERIENCE_PATTERNS: { re: RegExp; range: boolean }[] = [
  { re: new RegExp(`${NUM}\\s*\\+?${DASH}${NUM}${UNIT}`, "i"), range: true }, // 2-4 years, 2 to 4 yrs
  { re: new RegExp(`(?:exp(?:erience)?|yoe)\\s*[:\\-–]?\\s*(?:of\\s*)?${NUM}${DASH}${NUM}`, "i"), range: true }, // Exp: 2-4
  { re: new RegExp(`${NUM}${UNIT}`, "i"), range: false }, // 3+ years, 5 yrs
  { re: new RegExp(`(?:exp(?:erience)?|yoe)\\s*[:\\-–]\\s*${NUM}\\s*\\+?`, "i"), range: false }, // Exp: 3+
];

// Experience the post asks for. Ranges win over single numbers ("5 years in business ... 2-4 yrs").
export function extractExperience(text: string): Experience | null {
  for (const { re, range } of EXPERIENCE_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    const min = parseFloat(m[1]);
    const max = range ? parseFloat(m[2]) : null;
    if (min > 20 || (max !== null && (max < min || max > 25))) continue;
    return { min, max };
  }
  if (/\bfreshers?\b/i.test(text)) return { min: 0, max: 1 };
  return null;
}

export function formatExperience(exp: Experience | null): string {
  if (!exp) return "";
  return exp.max !== null ? `${exp.min}-${exp.max} yrs` : `${exp.min}+ yrs`;
}

export function extractAll(text: string, authorHeadline = "") {
  const emails = extractEmails(text);
  return {
    emails,
    experience: extractExperience(text),
    roles: extractRoles(text),
    companies: extractCompanies(text, emails, authorHeadline),
    technologies: extractTechnologies(text),
  };
}
