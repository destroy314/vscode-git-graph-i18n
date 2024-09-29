module.exports = {
    input: [
        'src/gitGraphView.ts',
        'web/main.ts',
    ],
    options: {
        compatibilityJSON: 'v3',
        debug: true,
        removeUnusedKeys: true,
        func: {
            list: ['t'],
            extensions: ['.ts']
        },
        lngs: ['en','zh-cn'],
        defaultValue: function(lng, ns, key) {
            if (lng === 'en') {
                return key;
            }
            return '__NOT_TRANSLATED__';
        },
        resource: {
            loadPath: 'i18n/{{lng}}.json',
            savePath: 'i18n/{{lng}}.json',
            jsonIndent: 4,
            lineEnding: '\n'
        },
    }
};
