import type { Field } from './form';
import type { Device, Vital } from './types';

/**
 * Demo protocols. Written for this POC, not clinically validated.
 * Guidelines live here as data; Jev only answers narrow questions about them.
 */
export const PROTOCOL_SOURCE = 'Demo protocol v0 (not clinically validated)';

export type Protocol = {
  label: string;
  /** Jev yes/no: does the complaint belong to this category? */
  detect: string;
  /** Visit questions, skipped when the patient's own words already answer them. */
  history: Field[];
  devices: Device[];
  tests: string[];
};

const onset: Field = {
  id: 'onset',
  section: 'visit',
  ask: 'When did this start?',
  covers: 'when the symptoms started or how long they have lasted',
  typed: {
    type: 'duration',
    unit: 'days',
    instructions: 'How long the symptoms have lasted so far',
  },
};

const fever: Field = {
  id: 'fever',
  section: 'visit',
  ask: 'Have you had a fever?',
  covers: 'whether the patient has or has not had a fever',
};

export const PROTOCOLS = {
  ent: {
    label: 'Ear, nose & throat',
    detect: 'Does `reason` describe an ear, nose, sinus or throat problem?',
    history: [
      onset,
      fever,
      {
        id: 'side',
        section: 'visit',
        ask: 'Which side is it: left, right, or both?',
        covers: 'which ear or side of the head or throat is affected',
      },
      {
        id: 'drainage_hearing',
        section: 'visit',
        ask: 'Any fluid from the ear or change in your hearing?',
        covers: 'ear drainage or discharge, or a change in hearing',
      },
    ],
    devices: ['otoscope', 'exam_camera'],
    tests: ['Rapid strep, if sore throat'],
  },
  respiratory: {
    label: 'Respiratory',
    detect: 'Does `reason` describe a cough, congestion, wheezing or other breathing complaint?',
    history: [
      onset,
      fever,
      {
        id: 'cough_type',
        section: 'visit',
        ask: 'Is your cough dry, or are you coughing anything up?',
        covers: 'whether the cough is dry or produces mucus or phlegm',
      },
      {
        id: 'short_of_breath',
        section: 'visit',
        ask: 'Do you get short of breath? When?',
        covers: 'whether the patient feels short of breath, and when',
      },
    ],
    devices: ['stethoscope', 'pulse_oximeter'],
    tests: ['COVID / flu swab'],
  },
  skin: {
    label: 'Skin',
    detect: 'Does `reason` describe a rash, spot, wound, bite or other skin problem?',
    history: [
      onset,
      {
        id: 'location',
        section: 'visit',
        ask: 'Where on your body is it?',
        covers: 'where on the body the skin problem is',
      },
      {
        id: 'changing',
        section: 'visit',
        ask: 'Is it spreading or changing?',
        covers: 'whether the skin problem is spreading, growing or changing',
      },
      {
        id: 'exposure',
        section: 'visit',
        ask: 'Any new soaps, plants, foods, medicines or pets?',
        covers: 'new exposures such as products, plants, foods, medicines or animals',
      },
    ],
    devices: ['exam_camera'],
    tests: [],
  },
  msk: {
    label: 'Muscles & joints',
    detect: 'Does `reason` describe pain or injury in a muscle, joint, back or bone?',
    history: [
      onset,
      {
        id: 'mechanism',
        section: 'visit',
        ask: 'How did it happen?',
        covers: 'how the injury or pain started, such as a fall, lifting or twisting',
      },
      {
        id: 'function',
        section: 'visit',
        ask: 'Can you put weight on it or move it normally?',
        covers: 'whether the patient can bear weight on or move the affected part',
      },
      {
        id: 'numbness',
        section: 'visit',
        ask: 'Any numbness or tingling?',
        covers: 'numbness, tingling or weakness',
      },
    ],
    devices: ['exam_camera'],
    tests: [],
  },
  urinary: {
    label: 'Urinary',
    detect: 'Does `reason` describe burning, pain, urgency or other trouble when urinating?',
    history: [
      onset,
      fever,
      {
        id: 'flank_pain',
        section: 'visit',
        ask: 'Any pain in your back or side?',
        covers: 'pain in the back, side or flank',
      },
    ],
    devices: [],
    tests: ['Urine dipstick'],
  },
  med_refill: {
    label: 'Medication refill',
    detect: 'Does `reason` ask for a prescription refill or more of a medication?',
    history: [
      {
        id: 'which_med',
        section: 'visit',
        ask: 'Which medication do you need refilled?',
        covers: 'which medication the patient needs refilled',
      },
      {
        id: 'side_effects',
        section: 'visit',
        ask: 'Any side effects from it?',
        covers: 'whether the medication is causing side effects',
      },
    ],
    devices: [],
    tests: [],
  },
} satisfies Record<string, Protocol>;

export type Category = keyof typeof PROTOCOLS;

export const CATEGORIES = Object.keys(PROTOCOLS) as Category[];

/** Used when no category is confident, and in degraded mode. */
export const GENERAL_HISTORY: Field[] = [
  onset,
  {
    id: 'severity',
    section: 'visit',
    ask: 'On a scale of 0 to 10, how bad is it?',
    covers: 'how severe the problem is',
  },
  {
    id: 'tried',
    section: 'visit',
    ask: 'What have you tried so far?',
    covers: 'treatments or medicines the patient has already tried',
  },
];

export const BASE_VITALS: Vital[] = [
  'blood_pressure',
  'heart_rate',
  'temperature',
  'spo2',
  'respiratory_rate',
];

/** Red flags go to the provider immediately. Biased toward recall: a miss is worse than a false alarm. */
export const RED_FLAGS = {
  chest_pain: {
    label: 'Chest pain or pressure',
    detect: 'Does `reason` mention chest pain, chest pressure or chest tightness?',
  },
  stroke: {
    label: 'Possible stroke signs',
    detect:
      'Does `reason` mention face drooping, arm or leg weakness on one side, slurred speech, sudden confusion or sudden vision loss?',
  },
  breathing: {
    label: 'Severe trouble breathing',
    detect:
      'Does `reason` describe severe trouble breathing, such as being unable to speak in full sentences or blue lips?',
  },
  allergic_reaction: {
    label: 'Possible severe allergic reaction',
    detect: 'Does `reason` mention swelling of the lips, tongue or throat, or trouble swallowing?',
  },
  worst_headache: {
    label: 'Sudden severe headache',
    detect: 'Does `reason` describe a sudden, severe or "worst ever" headache?',
  },
  self_harm: {
    label: 'Self-harm risk',
    detect: 'Does `reason` mention suicidal thoughts or wanting to hurt themselves?',
  },
} as const;

export type RedFlag = keyof typeof RED_FLAGS;
