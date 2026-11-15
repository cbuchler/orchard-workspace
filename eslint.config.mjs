import js from '@eslint/js';

export default [
    {
        files: ['extension.js', 'prefs.js', 'shell/**/*.js'],
        ...js.configs.recommended,
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                global: 'readonly',
                logError: 'readonly',
            },
        },
        rules: {
            ...js.configs.recommended.rules,
            'no-unused-vars': ['error', {argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_'}],
            'max-len': ['error', {code: 200, ignoreUrls: true}],
        },
    },
];
