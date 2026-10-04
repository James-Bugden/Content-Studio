/**
 * The site's guides, one Replies resource each (CS-058).
 *
 * Copied from the public Guides page of the Get The Offer site (the guide list and
 * descriptions in its guidesPage copy), not from anything private. "Add site guides"
 * on the Resources page saves each one through the normal resource path: owned
 * resources, a path on the resource origin, an optional Chinese path. Re-running it
 * adds only the guides that are not in the registry yet, matched by English path,
 * so it never duplicates and never overwrites a resource you have edited.
 *
 * When a guide is added to the site, add a line here and run the import again.
 */
export interface SiteGuide {
  title_en: string;
  title_zh_tw: string;
  description: string;
  canonical_path: string;
  zh_tw_path: string;
  /** The site's own category, kept as a tag so replies can match by topic. */
  category: string;
}

export const SITE_GUIDES: readonly SiteGuide[] = [
  { title_en: "Salary Confidence Playbook", title_zh_tw: "薪資談判實戰手冊", description: "Stop under-asking in interviews and reviews", canonical_path: "/salary-confidence-guide", zh_tw_path: "/zh-tw/salary-confidence-guide", category: "Salary & Negotiation" },
  { title_en: "Resume Guide", title_zh_tw: "履歷攻略", description: "How to write a resume that gets interviews", canonical_path: "/resume-guide", zh_tw_path: "/zh-tw/resume-guide", category: "Resume & LinkedIn" },
  { title_en: "Resume Quick Reference", title_zh_tw: "履歷速查表", description: "One-page cheat sheet", canonical_path: "/resume-quick-reference", zh_tw_path: "/zh-tw/resume-quick-reference", category: "Resume & LinkedIn" },
  { title_en: "LinkedIn Guide", title_zh_tw: "LinkedIn 指南", description: "Optimize your LinkedIn for recruiters", canonical_path: "/linkedin-guide", zh_tw_path: "/zh-tw/linkedin-guide", category: "Resume & LinkedIn" },
  { title_en: "LinkedIn Branding Guide", title_zh_tw: "LinkedIn 品牌指南", description: "Build your personal brand", canonical_path: "/linkedin-branding-guide", zh_tw_path: "/zh-tw/linkedin-branding-guide", category: "Resume & LinkedIn" },
  { title_en: "Interview Preparation Guide", title_zh_tw: "完整面試準備指南", description: "Step-by-step interview preparation with deep-dive examples", canonical_path: "/interview-preparation-guide", zh_tw_path: "/zh-tw/interview-preparation-guide", category: "Interview Prep" },
  { title_en: "How to Pass the Recruiter Call", title_zh_tw: "如何通過招募官電話面試", description: "Ace the first phone screen", canonical_path: "/recruiter-call-prep", zh_tw_path: "/zh-tw/recruiter-call-prep", category: "Interview Prep" },
  { title_en: "Problem Solving 101", title_zh_tw: "問題解決 101", description: "Structured thinking for interviews", canonical_path: "/problem-solving-guide", zh_tw_path: "/zh-tw/problem-solving-guide", category: "Interview Prep" },
  { title_en: "Tech Interview Storytelling Playbook", title_zh_tw: "科技業面試說故事手冊", description: "CARL+Learnings, 8 Signal Areas, and the FAANG delivery craft", canonical_path: "/tech-interview-storytelling", zh_tw_path: "/zh-tw/tech-interview-storytelling", category: "Interview Prep" },
  { title_en: "Pivot Method Guide", title_zh_tw: "轉職方法論", description: "Change careers successfully", canonical_path: "/pivot-method-guide", zh_tw_path: "/zh-tw/pivot-method-guide", category: "Career Strategy" },
  { title_en: "Ikigai Career Guide", title_zh_tw: "Ikigai 職涯指南", description: "Find work that gives you purpose", canonical_path: "/ikigai-guide", zh_tw_path: "/zh-tw/ikigai-guide", category: "Career Strategy" },
  { title_en: "Standout Skill Stack", title_zh_tw: "卓越技能組", description: "15 career skills recruiters actually notice", canonical_path: "/standout-skill-stack", zh_tw_path: "/zh-tw/standout-skill-stack", category: "Career Strategy" },
  { title_en: "Career Game Guide", title_zh_tw: "職涯遊戲指南", description: "Play your career strategically", canonical_path: "/career-game-guide", zh_tw_path: "/zh-tw/career-game-guide", category: "Career Strategy" },
  { title_en: "Headhunter's Playbook", title_zh_tw: "獵頭實戰手冊", description: "Nine plays a working headhunter runs every day", canonical_path: "/headhunters-playbook", zh_tw_path: "/zh-tw/headhunters-playbook", category: "Career Strategy" },
  { title_en: "Office Politics Guide", title_zh_tw: "職場政治指南", description: "Navigate workplace dynamics", canonical_path: "/office-politics-guide", zh_tw_path: "/zh-tw/office-politics-guide", category: "Career Strategy" },
  { title_en: "48 Laws of Power for Your Career", title_zh_tw: "職場權力的 48 條法則", description: "Apply timeless power principles at work", canonical_path: "/48-laws-guide", zh_tw_path: "/zh-tw/48-laws-guide", category: "Career Strategy" },
  { title_en: "How to Work with Recruiters", title_zh_tw: "如何與招募官合作", description: "How recruiters think (insider guide)", canonical_path: "/working-with-recruiters", zh_tw_path: "/zh-tw/working-with-recruiters", category: "Career Strategy" },
  { title_en: "AI Job Search Guide", title_zh_tw: "AI 求職指南", description: "Use AI tools to find jobs faster", canonical_path: "/ai-job-search-guide", zh_tw_path: "/zh-tw/ai-job-search-guide", category: "Job Search & Offers" },
  { title_en: "Job Offer Guide", title_zh_tw: "工作 Offer 指南", description: "Evaluate and negotiate offers", canonical_path: "/job-offer-guide", zh_tw_path: "/zh-tw/job-offer-guide", category: "Job Search & Offers" },
  { title_en: "Salary Starter Kit", title_zh_tw: "薪資談判入門", description: "Negotiation templates and framework", canonical_path: "/salary-starter-kit", zh_tw_path: "/zh-tw/salary-starter-kit", category: "Job Search & Offers" },
  { title_en: "How to Resign", title_zh_tw: "如何辭職", description: "Leave the old job cleanly", canonical_path: "/guides/how-to-resign", zh_tw_path: "/zh-tw/guides/how-to-resign", category: "Starting a New Role" },
  { title_en: "First 90 Days", title_zh_tw: "前 90 天", description: "Land well in the new role", canonical_path: "/guides/first-90-days", zh_tw_path: "/zh-tw/guides/first-90-days", category: "Starting a New Role" },
];

/** What a resource row holds for one guide: an owned guide, linkable in all three platforms. */
export function siteGuideFields(guide: SiteGuide) {
  return {
    type: 'guide' as const,
    ownership: 'own' as const,
    title_en: guide.title_en,
    title_zh_tw: guide.title_zh_tw,
    description: guide.description,
    aliases: [] as string[],
    tags: ['guide', guide.category.toLowerCase()],
    canonical_path: guide.canonical_path,
    zh_tw_path: guide.zh_tw_path,
    external_url: null,
    cta_en: null,
    cta_zh_tw: null,
    access_notes: null,
    active: true,
  };
}

/** The guides whose English path is not already a resource, so a re-run adds only what is new. */
export function missingSiteGuides(existing: readonly { canonical_path: string | null }[], guides: readonly SiteGuide[] = SITE_GUIDES): SiteGuide[] {
  const have = new Set(existing.map((r) => r.canonical_path).filter((p): p is string => Boolean(p)));
  return guides.filter((g) => !have.has(g.canonical_path));
}
