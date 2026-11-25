import { component, describeApples, renderI18nInterpolation, renderI18nTKeypath } from './messages.js';

const languages = {
    en: () => import('./i18n/en.po'),
    de: () => import('./i18n/de.po'),
};

export async function loadLanguage(language) {
    return (await languages[language]()).default;
}

export const loadLazy = () => import('./lazy.js');

export { component, describeApples, renderI18nInterpolation, renderI18nTKeypath };
