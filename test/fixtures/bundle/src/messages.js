export const component = {
    methods: {
        messages() {
            return [
                this.$t('Hello world'),
                this.$t('Say "hi"'),
                this.$t("It's here"),
                this.$t('First line\nSecond line'),
                this.$t('Non breaking'),
                this.$t('Concatenated ' + 'message'),
                this.$t('Untranslated in German'),
                this.$t('Fuzzy entry'),
                this.$t('Missing in German'),
                this.$t(`Template literal`),
                this.$t('Not in language files'),
            ];
        },
    },
};

export function describeApples(i18n, count) {
    return i18n.tc('{count} apple | {count} apples', count, { count });
}

// Like a render function compiled by vue-template-compiler for vue-i18n < 9's <i18n> component.
export function renderI18nInterpolation(_c) {
    return _c('i18n', { attrs: { path: 'Interpolated {link}', tag: 'span' } });
}

// Like a render function compiled by @vue/compiler-sfc for vue-i18n >= 9's <i18n-t> component.
export function renderI18nTKeypath(h, c) {
    return [h(c, { keypath: 'Keypath message', tag: 'p' })];
}
