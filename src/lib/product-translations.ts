import { Locale } from './i18n';

export type ProductLocale = {
  name: string;
  description: string;
  details: string[];
};

const en: Record<string, ProductLocale> = {
  'mk-ori-150': {
    name: 'Mie Kremes Original',
    description: 'Crunchy mie kremes with savory original seasoning. A perfect blend of dried noodles & natural spices that\'s addictively delicious.',
    details: [
      'Ingredients: Dried Noodles, Vegetable Oil, Kencur, Garlic, Lime Leaves',
      'HALAL Indonesia Certified',
      'NIB: 0403260068412 — Made in Bogor',
      'No preservatives, super crispy texture',
      'Perfect for afternoon snacking & relaxing',
    ],
  },
  'mk-pdas-150': {
    name: 'Spicy Mie Kremes',
    description: 'Mie kremes with real chili powder and signature spicy seasoning. A kick of spice, a crunch of deliciousness!',
    details: [
      'Ingredients: Dried Noodles, Real Chili Powder, Spicy Seasoning, Lime Leaves, Kencur, Garlic',
      'HALAL Indonesia Certified',
      'NIB: 0403260068412 — Made in Bogor',
      'No preservatives, super crispy texture',
      'For true spice lovers!',
    ],
  },
  'kk-ori-100': {
    name: 'Original Kimpul Chips',
    description: 'Super crunchy kimpul / taro balitung chips with a natural savory original flavor. Selected ingredients from local Bogor farmers.',
    details: [
      'Ingredients: Selected Kimpul Taro, Cooking Oil, Salt',
      'HALAL Indonesia Certified',
      'NIB: 0403260068412 — Made in Bogor',
      'No preservatives, stays fresh up to 3 months',
      'Great for souvenirs & daily snacking',
    ],
  },
  'kk-bbq-100': {
    name: 'Spicy BBQ Kimpul Chips',
    description: 'The perfect blend of smoky BBQ flavor and an addictive spicy kick. Crunchy with every bite!',
    details: [
      'Ingredients: Selected Kimpul Taro, Cooking Oil, Salt, BBQ Flavor Powder',
      'HALAL Indonesia Certified',
      'NIB: 0403260068412 — Made in Bogor',
      'No preservatives, stays fresh up to 3 months',
      'Great for snacking with friends & family',
    ],
  },
  'kk-jgn-100': {
    name: 'Sweet Corn Kimpul Chips',
    description: 'Kimpul chips with a delicious sweet corn flavor. Perfect for casual snacking anytime.',
    details: [
      'Ingredients: Selected Kimpul Taro, Cooking Oil, Salt, Sweet Corn Powder',
      'HALAL Indonesia Certified',
      'NIB: 0403260068412 — Made in Bogor',
      'No preservatives, stays fresh up to 3 months',
      'Kids\' favorite & great as a lunch box snack',
    ],
  },
  'kk-ori-250': {
    name: 'Jumbo Original Kimpul Chips',
    description: 'Original kimpul chips in a jumbo 250g size. More chips, more savings — perfect for home stock.',
    details: [
      'Ingredients: Selected Kimpul Taro, Cooking Oil, Salt',
      'HALAL Indonesia Certified',
      'NIB: 0403260068412 — Made in Bogor',
      'Jumbo 250g — better value than 100g',
      'Stays fresh up to 3 months from production',
    ],
  },
  'kk-bbq-250': {
    name: 'Jumbo Spicy BBQ Kimpul Chips',
    description: 'Spicy BBQ in a jumbo 250g size. A bigger portion to share with family and friends.',
    details: [
      'Ingredients: Selected Kimpul Taro, Cooking Oil, Salt, BBQ Flavor Powder',
      'HALAL Indonesia Certified',
      'NIB: 0403260068412 — Made in Bogor',
      'Jumbo 250g — even greater savings',
      'Stays fresh up to 3 months from production',
    ],
  },
  'kk-jgn-250': {
    name: 'Jumbo Corn Kimpul Chips',
    description: 'Sweet Corn flavor in a jumbo 250g size. The ideal choice for the whole family snacking together.',
    details: [
      'Ingredients: Selected Kimpul Taro, Cooking Oil, Salt, Sweet Corn Powder',
      'HALAL Indonesia Certified',
      'NIB: 0403260068412 — Made in Bogor',
      'Jumbo 250g — even greater savings',
      'Stays fresh up to 3 months from production',
    ],
  },
  'pk-mix3': {
    name: '3-Flavor Chips Bundle',
    description: 'Great deal! 3 pcs of 100g Kimpul Chips in 3 flavors: Original, Spicy BBQ, and Sweet Corn.',
    details: [
      'Contents: 3 pcs of 100g Kimpul Chips',
      'Flavors: Original + Spicy BBQ + Corn',
      'Mix and match your favorite flavors',
      'Save Rp 5,000 vs. buying individually',
      'Perfect as a gift & souvenir',
    ],
  },
  'pk-mix5': {
    name: '5 Pcs Chips Bundle',
    description: 'Super deal! 5 pcs of 100g Kimpul Chips, choose your own flavors. Perfect for souvenirs or gifts.',
    details: [
      'Contents: 5 pcs of 100g Kimpul Chips',
      'Mix and match all 3 flavors',
      'Save Rp 10,000 vs. buying individually',
      'Includes exclusive packaging',
      'Best choice for gifts & souvenirs',
    ],
  },
  'pk-campur': {
    name: 'Chips + Mie Kremes Combo Pack',
    description: 'The best combo pack! 2 Kimpul Chips + 2 Mie Kremes. Try both signature products at once.',
    details: [
      'Contents: 2 Kimpul Chips 100g + 2 Mie Kremes',
      'Choose your own flavor for each product',
      'Savings compared to buying individually',
      'Perfect for trying all our products',
      'Neatly packaged, ready to ship',
    ],
  },
};

export function getProductLocale(
  id: string,
  locale: Locale,
  fallback: ProductLocale,
): ProductLocale {
  if (locale === 'id') return fallback;
  return en[id] ?? fallback;
}
