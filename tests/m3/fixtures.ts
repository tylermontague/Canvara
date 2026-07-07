// M3 exit-test fixture: a scripted doorstep conversation with unambiguous
// ground truth for every SignalObject field. S0 = canvasser, S1 = voter.
//
// Ground truth this script encodes:
//   support_level      undecided (voter says so explicitly, twice)
//   top_issues         property_taxes first (spontaneous, dominant), schools
//                      (prompted, engaged)
//   issue_sentiment    property_taxes: negative · schools: positive
//   emotional_valence  frustrated (voter vents repeatedly about taxes)
//   persuadability     persuadable (undecided, engaged, asks questions)
//   information_gaps   candidate's property-tax position in writing; early
//                      voting dates
//   message_resonance  assessment-freeze plan → positive · school-funding
//                      message → neutral/positive
//   follow_up_signals  send the tax plan flyer; spouse home after 6pm
//   provenance         property_taxes: spontaneous · schools: prompted
//   confidence         high (clear, substantive conversation) → ≥ 0.6

import type { TranscriptUtterance } from "@canvara/shared";

export const SCRIPTED_TRANSCRIPT: TranscriptUtterance[] = [
  { speaker: "S0", ts: 0, text: "Hi, good evening! I'm Sam, a volunteer with the Rivera for County Supervisor campaign. Just so you know, I use automated notes so I can focus on our conversation. Do you have two minutes?" },
  { speaker: "S1", ts: 9, text: "I guess so, sure." },
  { speaker: "S0", ts: 11, text: "Thanks! Is there anything around here that's been on your mind lately, things the county should be doing better?" },
  { speaker: "S1", ts: 16, text: "Honestly? The property taxes. My assessment went up nineteen percent this year. Nineteen percent! We've been in this house twenty-two years and I've never seen a jump like that. It's getting to where people on fixed incomes can't stay in their own homes. It makes me so angry, nobody at the county even answers the phone when you call about it." },
  { speaker: "S0", ts: 38, text: "That's exactly the kind of thing Maria Rivera is running on. She's proposing a freeze on assessment increases for primary residences over sixty-five, and capping annual increases at five percent for everyone else. Does that sound like it would help?" },
  { speaker: "S1", ts: 52, text: "A five percent cap? Yeah, that would actually help a lot, if she can really do it. That's the first concrete thing I've heard from anybody on this. But politicians promise things all the time." },
  { speaker: "S0", ts: 63, text: "Fair. Can I ask what you think about the schools here? Rivera also wants to redirect some county funds into after-school programs." },
  { speaker: "S1", ts: 71, text: "The schools are actually the one thing that's still good around here. My grandkids go to Fremont Elementary and the teachers are wonderful. After-school programs would be fine I suppose, but that's not what keeps me up at night. The taxes are." },
  { speaker: "S0", ts: 85, text: "Understood. So, thinking about the supervisor race in November — do you know who you're voting for?" },
  { speaker: "S1", ts: 91, text: "I really haven't decided. I usually vote, I always vote, but I don't know either of these candidates well. Like I said, if Rivera is serious about the tax cap, that would matter to me. Can you send me something in writing about that plan? I want to actually read it, not just hear it at my door." },
  { speaker: "S0", ts: 106, text: "Absolutely, I'll have the campaign mail you the tax plan one-pager. Anything else I can help with?" },
  { speaker: "S1", ts: 112, text: "When does early voting start? I'd rather not deal with the lines. And you should come back when my husband's home, after six most days — he's the one who really follows this stuff. He's even more worked up about the assessments than I am." },
  { speaker: "S0", ts: 124, text: "I'll find the early voting dates and include them with the mailer, and we'll swing by after six sometime. Thanks so much for your time!" },
  { speaker: "S1", ts: 131, text: "Alright. Thanks for actually listening, most of them don't." },
];

/** Deliberately thin/garbled — should extract at low confidence → review. */
export const GARBLED_TRANSCRIPT: TranscriptUtterance[] = [
  { speaker: "S0", ts: 0, text: "Hi, I'm with the, uh, the campaign, we use automated notes, is that..." },
  { speaker: "S1", ts: 4, text: "what... no I... [inaudible] the thing with the" },
  { speaker: "S0", ts: 8, text: "sorry, the supervisor race, are you..." },
  { speaker: "S1", ts: 10, text: "[inaudible] maybe... busy right now honestly" },
];
