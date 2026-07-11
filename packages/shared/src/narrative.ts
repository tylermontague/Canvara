// Campaign narrative (M15): the candidate's persona — story, values,
// voice, and biographical proof points. Authored once per campaign and
// injected into every generated message and canvass spark so all voter
// contact is coherent and on-brand. Shared so the messaging package and
// the console read one shape.

import type { DbClient } from "@canvara/db";

export interface CampaignNarrative {
  candidateName: string | null;
  pitch: string | null;
  story: string | null;
  values: string[];
  signatureIssues: string[];
  proofPoints: string[];
  tone: string | null;
}

export async function fetchCampaignNarrative(
  db: DbClient,
  campaignId: string,
): Promise<CampaignNarrative | null> {
  const { data, error } = await db
    .from("campaign_narrative")
    .select("candidate_name, pitch, story, values, signature_issues, proof_points, tone")
    .eq("campaign_id", campaignId)
    .maybeSingle();
  if (error) throw new Error(`campaign narrative: ${error.message}`);
  if (!data) return null;
  return {
    candidateName: data.candidate_name,
    pitch: data.pitch,
    story: data.story,
    values: data.values ?? [],
    signatureIssues: data.signature_issues ?? [],
    proofPoints: data.proof_points ?? [],
    tone: data.tone,
  };
}

/** True when the narrative carries enough to actually shape generation. */
export function narrativeHasContent(n: CampaignNarrative | null): n is CampaignNarrative {
  if (!n) return false;
  return Boolean(
    n.candidateName ||
      n.pitch ||
      n.story ||
      n.tone ||
      n.values.length ||
      n.signatureIssues.length ||
      n.proofPoints.length,
  );
}

/**
 * Render the narrative as a grounding block for a generation prompt.
 * Deterministic (exit-testable). Returns "" when there's nothing to say,
 * so callers can skip the block cleanly.
 */
export function formatNarrativeForPrompt(n: CampaignNarrative | null): string {
  if (!narrativeHasContent(n)) return "";
  const lines: string[] = [];
  if (n.candidateName) lines.push(`Candidate: ${n.candidateName}`);
  if (n.pitch) lines.push(`Pitch: ${n.pitch}`);
  if (n.story) lines.push(`Story: ${n.story}`);
  if (n.values.length) lines.push(`Core values: ${n.values.join("; ")}`);
  if (n.signatureIssues.length) lines.push(`Signature issues: ${n.signatureIssues.join("; ")}`);
  if (n.proofPoints.length) lines.push(`Proof points: ${n.proofPoints.join("; ")}`);
  if (n.tone) lines.push(`Voice / tone: ${n.tone}`);
  return lines.join("\n");
}
