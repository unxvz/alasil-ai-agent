import { distinctValues } from './catalog.js';

const FIELD_ORDER = {
  iPhone:        ['family', 'variant', 'storage_gb', 'color', 'region'],
  iPad:          ['family', 'chip', 'storage_gb', 'connectivity', 'color'],
  Mac:           ['family', 'chip', 'storage_gb', 'ram_gb', 'color', 'keyboard_layout'],
  AirPods:       ['family'],
  'Apple Watch': ['family', 'screen_inch', 'color', 'connectivity'],
};

const QUESTION_TEXT = {
  en: {
    category:        'What are you looking for? iPhone, iPad, or Mac?',
    family:          'Which line?',
    variant:         'Which variant?',
    chip:            'Which chip?',
    ram_gb:          'How much RAM?',
    storage_gb:      'Which storage?',
    screen_inch:     'Which screen size?',
    color:           'Which color?',
    region:          'Middle East or International?',
    sim:             'Which SIM configuration?',
    keyboard_layout: 'Which keyboard layout?',
    connectivity:    'Wi-Fi only or Wi-Fi + Cellular?',
  },
  fa: {
    category:        'دنبال چه محصولی هستید؟ آیفون، آیپد، یا مک؟',
    family:          'کدام سری؟',
    variant:         'کدام نسخه؟',
    chip:            'کدام چیپ؟',
    ram_gb:          'چقدر رم؟',
    storage_gb:      'چه حافظه‌ای؟',
    screen_inch:     'اندازه صفحه چند اینچ؟',
    color:           'چه رنگی؟',
    region:          'نسخه خاورمیانه یا بین‌المللی؟',
    sim:             'چه پیکربندی سیم‌کارتی؟',
    keyboard_layout: 'چه لایه‌ی کیبوردی؟',
    connectivity:    'فقط Wi-Fi یا Wi-Fi + Cellular؟',
  },
};

function pickQuestionText(field, language) {
  const pack = QUESTION_TEXT[language] || QUESTION_TEXT.en;
  return pack[field] || QUESTION_TEXT.en[field] || 'Could you share more details?';
}

function fieldsForCategory(category) {
  return FIELD_ORDER[category] || [];
}

function formatOptions(values, field) {
  if (!values || values.length === 0) return '';
  const shaped = values.slice(0, 4).map((v) => {
    if (field === 'storage_gb') {
      const n = Number(v);
      return n >= 1024 ? `${Math.round(n / 1024)}TB` : `${n}GB`;
    }
    if (field === 'ram_gb')      return `${v}GB`;
    if (field === 'screen_inch') return `${v}-inch`;
    return String(v);
  });
  const rest = values.length > 4 ? values.length - 4 : 0;
  let out = shaped.map((s, idx) => `${idx + 1}. ${s}`).join('\n');
  if (rest > 0) out += `\n(${rest} more — tell me what you need)`;
  return out;
}

export async function nextClarification(profile, intent, language) {
  const category = profile.category || null;

  if (!category) {
    return {
      field: 'category',
      text: pickQuestionText('category', language),
      options: ['iPhone', 'iPad', 'Mac'],
    };
  }

  const fields = fieldsForCategory(category);
  for (const field of fields) {
    if (profile[field] !== undefined && profile[field] !== null && profile[field] !== '') continue;
    const values = await distinctValues(field, profile);
    if (values.length === 0) continue;
    if (values.length === 1) {
      profile[field] = values[0];
      continue;
    }
    const text = `${pickQuestionText(field, language)}\n${formatOptions(values, field)}`;
    return { field, text, options: values.slice(0, 4) };
  }
  return null;
}

export function isProfileComplete(profile) {
  const category = profile.category;
  if (!category) return false;
  const fields = fieldsForCategory(category);
  for (const f of fields) {
    if (profile[f] === undefined || profile[f] === null || profile[f] === '') return false;
  }
  return true;
}
