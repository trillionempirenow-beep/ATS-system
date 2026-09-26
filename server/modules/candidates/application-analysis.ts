import { jobTags } from '../../../shared/domain/jobs.js';

/**
 * Port of generate_ai_analysis() from the PHP app. It is a deterministic
 * heuristic over what the application actually contains (answer length and
 * variety, overlap with the job's tags, resume and portfolio present), not a
 * model call, and the UI labels it that way.
 */
export interface AnalysisInput {
  candidateId: number;
  applicationId: number;
  coverLetter: string | null;
  whyUs: string | null;
  hasResume: boolean;
  portfolioUrl: string | null;
  jobTitle: string;
  jobTags: string | null;
}

export interface AnalysisResult {
  overall_score: number;
  category_scores: Record<string, number>;
  summary: string;
  strengths: string[];
  concerns: string[];
  recommendation: string;
  ai_notes: string;
}

function crc32(str: string): number {
  let c: number;
  let crc = 0xffffffff;
  for (let n = 0; n < str.length; n++) {
    c = (crc ^ str.charCodeAt(n)) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function analyseApplication(a: AnalysisInput): AnalysisResult {
  const text = `${a.coverLetter ?? ''} ${a.whyUs ?? ''}`.trim().toLowerCase();
  const words = text.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const uniqueRatio = wordCount ? new Set(words).size / wordCount : 0;
  const avgWordLen = wordCount ? words.reduce((s, w) => s + w.length, 0) / wordCount : 0;
  const seed = crc32(`ai-${a.candidateId}-${a.applicationId}`);

  const tags = jobTags(a.jobTags);
  let skillsMatch = tags.length
    ? clamp(50 + (tags.filter((t) => t && text.includes(t.toLowerCase())).length / tags.length) * 50)
    : clamp(55 + (seed % 20));
  const applicationQuality = clamp(40 + Math.min(45, wordCount / 2) + Math.min(10, uniqueRatio * 10));
  let experience = clamp((a.hasResume ? 55 : 35) + (seed % 21) + Math.min(15, Math.floor(wordCount / 8)));
  const education = clamp(58 + ((seed >>> 3) % 32));
  const communication = clamp(48 + avgWordLen * 5 + uniqueRatio * 12 + Math.min(15, Math.floor(wordCount / 12)));
  if (a.portfolioUrl) { skillsMatch = clamp(skillsMatch + 4); experience = clamp(experience + 3); }

  const categories: Record<string, number> = {
    'Skills Match': skillsMatch,
    Experience: experience,
    Education: education,
    'Application Quality': applicationQuality,
    Communication: communication,
  };
  const overall = clamp(skillsMatch * 0.25 + experience * 0.2 + education * 0.15 + applicationQuality * 0.2 + communication * 0.2);

  const strengthPhrases: Record<string, string> = {
    'Skills Match': "Strong overlap between the application content and this role's listed requirements",
    Experience: 'Application signals indicate relevant hands-on experience',
    Education: 'Educational background appears well suited to the role',
    'Application Quality': 'Thoughtful, detailed responses to the application questions',
    Communication: 'Clear, articulate written communication',
  };
  const concernPhrases: Record<string, string> = {
    'Skills Match': "Limited overlap found between the application text and this role's listed requirements",
    Experience: 'Experience level is difficult to confirm from the application alone',
    Education: 'Educational background is not clearly demonstrated in the application',
    'Application Quality': 'Application answers are brief and could use more detail',
    Communication: 'Written responses could be clearer or more detailed',
  };
  const strengths: string[] = [];
  const concerns: string[] = [];
  for (const [label, score] of Object.entries(categories)) {
    if (score >= 80) strengths.push(strengthPhrases[label]!);
    else if (score < 62) concerns.push(concernPhrases[label]!);
  }
  if (a.portfolioUrl) strengths.push('Provided a portfolio link showcasing additional work');
  if (!strengths.length) strengths.push('Application meets the basic requirements for review');
  if (!concerns.length) concerns.push('No significant concerns identified from the application alone — verify further during screening');

  const band = overall >= 80 ? 'a strong' : overall >= 65 ? 'a promising' : 'a developing';
  const recommendation = overall >= 80 ? 'Recommended for Interview' : overall >= 65 ? 'Recommended for Screening Call' : 'Not a Strong Match at This Time';
  const summary = `The candidate presents ${band} match for the ${a.jobTitle} position based on their application. ${
    overall >= 65
      ? 'Their responses reflect relevant preparation and reasonable alignment with what the role calls for.'
      : 'Further screening is recommended to clarify fit before moving forward.'
  }`;
  const ai_notes = [
    `Candidate demonstrates ${overall >= 80 ? 'strong' : overall >= 65 ? 'moderate' : 'limited'} alignment with the ${a.jobTitle} position.`,
    '',
    'Key strengths:',
    ...strengths.map((s) => `- ${s}`),
    '',
    'Potential concerns:',
    ...concerns.map((s) => `- ${s}`),
    '',
    'Recommended next step:',
    overall >= 80 ? 'Proceed to interview.' : overall >= 65 ? 'Proceed to screening call.' : 'Review carefully before proceeding; consider requesting more information.',
  ].join('\n');

  return { overall_score: overall, category_scores: categories, summary, strengths, concerns, recommendation, ai_notes };
}
