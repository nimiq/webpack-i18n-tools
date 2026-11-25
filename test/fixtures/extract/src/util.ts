import i18n from './i18n';

export function messages(context: any, root: any) {
    return [
        i18n.t('From i18n.t'),
        i18n.tc('From i18n.tc | From i18n.tc plural', 2),
        context.root.$t('From context.root.$t'),
        context.root.$i18n.t('From context.root.$i18n.t'),
        root.$t('From root.$t'),
        i18n.t('Shared message'),
        i18n.t('Escaped "quotes" and \'apostrophes\''),
        i18n.t('Line one\nLine two'),
    ];
}
