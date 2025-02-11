module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	testMatch: [
		'**/tests/**/*.ts'
	],
	testPathIgnorePatterns: [
		'./tests/testHelpers.ts'
	],
	testTimeout: 1000000,  // This matches your current 1000000ms timeout
	transform: {
		'^.+\\.ts$': 'ts-jest',
	},
	setupFilesAfterEnv: ['jest-expect-message']
}
