module.exports = {
    ci: {
        collect: {
            staticDistDir: './dist/apps/frontend/browser',
            numberOfRuns: 3,
            settings: {
                chromeFlags: ['--no-sandbox', '--disable-dev-shm-usage'],
                blockedUrlPatterns: ['https://angular-nest-cicd-api.onrender.com/*'],
            },
        },
        assert: {
            assertions: {
                'categories:performance': ['error', { minScore: 0.9 }],
                'categories:accessibility': ['error', { minScore: 0.9 }],
                'categories:best-practices': ['error', { minScore: 0.9 }],
                'categories:seo': ['error', { minScore: 0.8 }],
            },
        },
        upload: {
            target: 'temporary-public-storage',
        },
    },
};
