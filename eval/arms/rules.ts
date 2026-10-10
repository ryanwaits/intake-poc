import type { Decisions } from '../../src/core/decisions';
import { CATEGORIES, type Category, RED_FLAGS, type RedFlag } from '../../src/core/protocols';
import { buildQuestions } from '../../src/core/questions';
import type { Decide } from '../../src/core/run';
import type { Intake } from '../../src/core/types';

/**
 * Arm A: no model. Keyword patterns, the way a rules engine would start.
 * A fair attempt, written once before seeing arena results.
 */

const FLAGS: Record<RedFlag, RegExp> = {
  chest_pain: /chest\s*(pain|pressure|tight|hurts)|(pressure|tight\w*|pain) in (my )?chest/i,
  stroke: /droop|slurr|face.*(numb|weak)|one side.*(weak|numb)|can'?t (speak|talk|move my)/i,
  breathing: /can'?t (breathe|catch)|barely.*breath|lips.*blue|gasping|full sentence/i,
  allergic_reaction: /(lips?|tongue|throat|face).*(swell|swollen|clos)/i,
  worst_headache: /worst headache|thunderclap|sudden.*severe headache/i,
  self_harm: /suicid|kill (my)?self|hurt(ing)? myself|end(ing)? (my|it)|harm myself/i,
};

const COMPLAINTS: Record<Category, RegExp> = {
  ent: /\bear\b|ears\b|throat|sinus|nose|stuffy/i,
  respiratory: /cough|congest|wheez|phlegm|mucus|chest cold/i,
  skin: /rash|skin|\bspot\b|bite|itch|hives|bump/i,
  msk: /knee|back pain|wrist|ankle|shoulder|joint|muscle|sprain|hip\b/i,
  urinary: /\bpee|urinat|bladder|burns? when/i,
  med_refill: /refill|prescription|run(ning)? out of|more of my/i,
};

const FIELDS: Record<string, RegExp> = {
  onset:
    /\b(\d+|a|one|two|three|few|couple( of)?) (day|week|hour|month)s?\b|yesterday|this morning|last night|since|started|began/i,
  fever: /fever|temp|warm|chills|\b\d{3}(\.\d)?\b/i,
  side: /\bleft\b|\bright\b|both sides/i,
  drainage_hearing: /fluid|drain|discharge|hearing|muffled/i,
  cough_type: /\bdry\b|mucus|phlegm|productive|coughing up/i,
  short_of_breath: /short of breath|winded|breath/i,
  location: /\bon my\b|\barm\b|forearm|\bleg\b|\bback\b|\bface\b|\bneck\b|\bhand\b|\bfoot\b/i,
  changing: /spread|chang|bigger|grow/i,
  exposure: /\bnew\b|soap|plant|weed|\bpet\b|food|detergent|nothing new/i,
  mechanism: /twist|\bfell\b|lift|injur|\bhit\b|playing|on its own|no injury/i,
  function: /\bwalk|weight|can'?t move|move it/i,
  numbness: /numb|tingl/i,
  flank_pain: /\bside\b|flank|lower back/i,
  side_effects: /side effect|dizzy|stomach|upset/i,
  pregnancy: /pregnan|birth control/i,
  fall_risk: /\bfell\b|\bfall|tumble|fallen/i,
};

const hit = (re: RegExp | undefined, text: string) => (re?.test(text) ? 1 : 0);

export function rulesDecide(): Decide {
  return async (intake: Intake): Promise<Decisions> => {
    const started = performance.now();
    const text = intake.reason;
    const flags = Object.fromEntries(
      (Object.keys(RED_FLAGS) as RedFlag[]).map((id) => [id, hit(FLAGS[id], text)]),
    ) as Record<RedFlag, number>;
    const complaints = Object.fromEntries(
      CATEGORIES.map((id) => [id, hit(COMPLAINTS[id], text)]),
    ) as Record<Category, number>;
    const medNames = intake.patient.medications.map((m) => m.split(' ')[0]?.toLowerCase() ?? '');
    const answered = Object.fromEntries(
      buildQuestions(intake).fieldIds.map((id) => [
        id,
        id === 'which_med'
          ? medNames.some((m) => m && text.toLowerCase().includes(m))
            ? 1
            : 0
          : hit(FIELDS[id], text),
      ]),
    );
    const urgent = Object.values(flags).some((p) => p === 1);
    const onlyRefill =
      complaints.med_refill === 1 &&
      CATEGORIES.every((c) => c === 'med_refill' || complaints[c] === 0);
    return {
      model: 'rules',
      setting: {
        value: urgent ? 'emergency' : onlyRefill ? 'message' : 'clinic',
        confidence: 1,
      },
      flags,
      complaints,
      answered,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Math.round(performance.now() - started),
      },
    };
  };
}
