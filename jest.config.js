module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/tests/**/*.test.js'],
    collectCoverageFrom: [
        'middleware/**/*.js',
        'config/**/*.js',
        'services/anomaly-detector.js'
    ],
    coverageDirectory: 'coverage',
    verbose: true,
    testTimeout: 10000
};
