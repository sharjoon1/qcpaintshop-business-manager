// ESLint flat config (v9+). Lax rules for a 70k-LOC codebase — tighten over time.
const js = require('@eslint/js');
const globals = require('globals');

const sharedRules = {
    // Warnings only — don't fail commits over things the codebase already does
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'no-useless-escape': 'warn',
    'no-prototype-builtins': 'off',
    'no-control-regex': 'off',
    'no-async-promise-executor': 'warn',
    'no-inner-declarations': 'off',

    // Real bugs — keep as errors
    'no-undef': 'error',
    'no-unreachable': 'error',
    'no-dupe-keys': 'error',
    'no-dupe-args': 'error',
    'no-func-assign': 'error',
    'no-cond-assign': 'error',
    'use-isnan': 'error',
    'valid-typeof': 'error',
};

module.exports = [
    {
        ignores: [
            'node_modules/**',
            'public/**',           // browser JS — different env, lint separately if needed
            'archive/**',
            'coverage/**',
            'docs/**',
            'bmad/**',
            'logs/**',
            '.husky/**',
            '*.bak.*',
            '**/*.min.js',
        ],
    },
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
                ...globals.jest,
            },
        },
        rules: sharedRules,
    },
    {
        files: ['**/*.mjs'],
        languageOptions: {
            sourceType: 'module',
        },
        rules: sharedRules,
    },
    // Test files: more permissive
    {
        files: ['**/*.test.js', 'tests/**/*.js', '__tests__/**/*.js'],
        rules: {
            'no-unused-vars': 'off',
        },
    },
];
