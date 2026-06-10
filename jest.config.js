module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/tests/**/*.test.js'],
    collectCoverageFrom: [
        'middleware/**/*.js',
        'config/**/*.js',
        'routes/**/*.js',
        'services/**/*.js'
    ],
    coverageDirectory: 'coverage',
    verbose: true,
    testTimeout: 10000
};
