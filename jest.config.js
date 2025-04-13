module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	testMatch: [
		// '**/tests/**/driftVaults.ts'
		// '**/tests/**/*.test.ts'
		'**/tests/**/*.ts'
	],
	testPathIgnorePatterns: [
		'tests/common/',
		'tests/fixtures/',
		//'tests/driftVaults.ts'
	],
	testTimeout: 1000000,  // This matches your current 1000000ms timeout
	transform: {
		'^.+\\.ts$': 'ts-jest',
	},
	setupFilesAfterEnv: ['jest-expect-message']
}
