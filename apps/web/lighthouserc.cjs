// Lighthouse CI (§2.10): performance ≥ 90 and accessibility ≥ 95 on the
// Atlas and the Codebook, against the production build serving the
// synthetic fixture tier. Mobile emulation (Lighthouse's default): the
// proposal's target is "fast on a phone on a bad connection".

module.exports = {
    ci: {
        collect: {
            url: ['http://localhost:4173/', 'http://localhost:4173/codebook'],
            startServerCommand: 'pnpm preview --port 4173 --strictPort',
            startServerReadyPattern: 'Local',
            numberOfRuns: 1,
        },
        assert: {
            assertions: {
                'categories:performance': ['error', { minScore: 0.9 }],
                'categories:accessibility': ['error', { minScore: 0.95 }],
            },
        },
        upload: {
            target: 'filesystem',
            outputDir: './lhci-report',
        },
    },
}
